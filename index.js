require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const FluxerClient = require('./bridgeClient');
const axios = require('axios');

function loadConfig() {
  const configPath = process.argv[2] || process.env.CONFIG_PATH || 'config.json';
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found at ${absolutePath}`);
  }

  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function fluxerAvatarUrl(authorId, avatarHash) {
  if (!authorId || !avatarHash) return null;
  return `https://fluxerusercontent.com/avatars/${authorId}/${avatarHash}.webp`;
}

async function main() {
  const config = loadConfig();
  if (!config.discord || !config.fluxer) {
    throw new Error('Missing required discord or fluxer config sections.');
  }

  const discordToken = config.discord.token || process.env.DISCORD_TOKEN;
  const globalDiscordWebhookUrl = config.discord.webhookUrl;
  const fluxerToken = config.fluxer.token || process.env.FLUXER_BOT_TOKEN;
  const fluxerBaseUrl = config.fluxer.baseUrl || 'https://api.fluxer.app';
  const fluxerVersion = config.fluxer.version || '1';

  if (!discordToken) throw new Error('Discord bot token is required.');
  if (!fluxerToken) throw new Error('Fluxer bot token is required.');

  const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
  });

  const fluxerConfig = {
    baseUrl: fluxerBaseUrl,
    token: fluxerToken,
    version: fluxerVersion
  };

  const fluxerClient = new FluxerClient(fluxerConfig);

  // Build channel mappings
  const mappings = config.mappings || [];
  const channelMappings = Array.isArray(mappings) ? mappings : [mappings];

  const bridges = [];
  for (const mapping of channelMappings) {
    const discordChannelId = mapping.discordChannelId || mapping.discordChannel;
    const fluxerChannelId = mapping.fluxerChannelId || mapping.fluxerChannel;
    const fluxerWebhookUrl = mapping.fluxerWebhookUrl || config.fluxer?.webhookUrl;
    const discordWebhookUrl = mapping.discordWebhookUrl || globalDiscordWebhookUrl;

    if (!discordChannelId || !fluxerChannelId) continue;

    const bridge = {
      discordChannelId,
      fluxerChannelId,
      fluxerWebhookUrl,
      discordWebhookUrl,
      discordToFluxer: new Map(),
      fluxerToDiscord: new Map()
    };
    bridges.push(bridge);
  }

  if (bridges.length === 0) {
    throw new Error('No valid channel mappings found.');
  }

  // Fluxer message handler
  fluxerClient.onMessage = async (message) => {
    if (!message || message.source !== 'fluxer') return;

    // Find the bridge for this fluxer channel
    const bridge = bridges.find(b => b.fluxerChannelId === message.channelId);
    if (!bridge) return;

    const channel = await discordClient.channels.fetch(bridge.discordChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error(`Discord channel not found: ${bridge.discordChannelId}`);
      return;
    }

    if (message.replyTo) {
      const originalDiscordId = bridge.fluxerToDiscord.get(message.replyTo);
      if (originalDiscordId) {
        try {
          const originalMsg = await channel.messages.fetch(originalDiscordId).catch(() => null);
          if (originalMsg) {
            await originalMsg.reply(`${message.author}: ${message.content}`);
          }
        } catch (error) {
          console.error('Failed to reply to Discord message:', error.message || error);
        }
        return;
      }
    }

    let sent;
    if (bridge.discordWebhookUrl) {
      try {
        const avatarUrl = message.avatar && message.authorId ? fluxerAvatarUrl(message.authorId, message.avatar) : null;
        sent = await axios.post(bridge.discordWebhookUrl, {
          content: message.content,
          username: message.author,
          avatar_url: avatarUrl
        });
        // Webhook doesn't return message ID, use a placeholder
        const fakeDiscordId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        bridge.discordToFluxer.set(fakeDiscordId, message.messageId);
      } catch (error) {
        console.error('Failed to send Fluxer message to Discord via webhook:', error.message || error);
        return;
      }
    } else {
      const text = `**${message.author}**: ${message.content}`;
      sent = await channel.send({ content: text }).catch((error) => {
        console.error('Failed to send Fluxer message to Discord:', error.message || error);
      });
      if (!sent) return;
      bridge.discordToFluxer.set(sent.id, message.messageId);
    }
    // Also populate the reverse map for replies
    bridge.fluxerToDiscord.set(message.messageId, sent ? sent.id || `webhook_${Date.now()}` : null);
  };

  discordClient.once('ready', async () => {
    console.log(`Discord bot logged in as ${discordClient.user.tag}`);
    await fluxerClient.start();
  });

  // Discord message handler
  discordClient.on('messageCreate', async (message) => {
    if (message.author?.bot) return;

    // Find the bridge for this discord channel
    const bridge = bridges.find(b => b.discordChannelId === message.channel.id);
    if (!bridge) return;

    const content = message.content.trim();
    if (!content) return;

    if (message.reference) {
      const refMsgId = message.reference.messageId;
      // Look up the Fluxer message ID that corresponds to the referenced Discord message
      const originalFluxerId = bridge.discordToFluxer.get(refMsgId);
      if (originalFluxerId) {
        if (bridge.fluxerWebhookUrl) {
          try {
            // Include message_reference in webhook payload for threaded replies
            await axios.post(bridge.fluxerWebhookUrl, {
              content: `${message.author.username}: ${content}`,
              message_reference: originalFluxerId
            });
          } catch (error) {
            console.error('Failed to send reply via Fluxer webhook:', error.message || error);
          }
          console.log(`Relayed Discord reply from ${message.author.username} to Fluxer via webhook.`);
        } else {
          const sent = await fluxerClient.sendMessage(bridge.fluxerChannelId, `${message.author.username}: ${content}`, {
            message_reference: originalFluxerId
          });
          // Map the new Fluxer reply message to the original Discord message it replied to
          if (sent && sent.id) {
            bridge.fluxerToDiscord.set(sent.id, message.id);
          }
          console.log(`Relayed Discord reply from ${message.author.username} to Fluxer.`);
        }
        return;
      }
    }

    if (bridge.fluxerWebhookUrl) {
      try {
        const res = await axios.post(bridge.fluxerWebhookUrl, {
          content: `${message.author.username}: ${content}`,
          username: message.author.username,
          avatar_url: message.author.displayAvatarURL({ dynamic: true })
        });
        // Webhook response may not include message ID; use a placeholder
        const fakeFluxerId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        bridge.fluxerToDiscord.set(fakeFluxerId, message.id);
      } catch (error) {
        console.error('Failed to send Discord message to Fluxer via webhook:', error.message || error);
        return;
      }
      console.log(`Relayed Discord message from ${message.author.username} to Fluxer via webhook.`);
    } else {
      try {
        const sent = await fluxerClient.sendMessage(bridge.fluxerChannelId, `${message.author.username}: ${content}`, {
          message_reference: null
        });
        bridge.fluxerToDiscord.set(sent.id, message.id);
      } catch (error) {
        console.error('Failed to send Discord message to Fluxer:', error.message || error);
        return;
      }
      console.log(`Relayed Discord message from ${message.author.username} to Fluxer.`);
    }
  });

  discordClient.login(discordToken).catch((error) => {
    console.error('Discord login failed:', error.message || error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('Bridge startup failed:', error.message || error);
  process.exit(1);
});
