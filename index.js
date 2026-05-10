require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, WebhookClient } = require('discord.js');
const FluxerClient = require('./fluxerClient');
const axios = require('axios');

function loadConfig() {
  const configPath = process.argv[2] || process.env.CONFIG_PATH || 'config.json';
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found at ${absolutePath}`);
  }

  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

const discordToFluxer = new Map();
const fluxerToDiscord = new Map();

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
  const discordChannelId = config.discord.channelId || config.mappings?.discordChannelId;
  const fluxerChannelId = config.fluxer.channelId || config.mappings?.fluxerChannelId;
  const fluxerToken = config.fluxer.token || process.env.FLUXER_BOT_TOKEN;
  const relayPrefix = config.relayPrefix || '[Fluxer]';
  const discordWebhookUrl = config.discord.webhookUrl;
  const fluxerWebhookUrl = config.fluxer.webhookUrl;

  if (!discordToken) throw new Error('Discord bot token is required.');
  if (!discordChannelId) throw new Error('Discord channel ID is required.');
  if (!fluxerToken) throw new Error('Fluxer bot token is required.');
  if (!fluxerChannelId) throw new Error('Fluxer channel ID is required.');

  const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
  });

  const discordWebhook = discordWebhookUrl ? new WebhookClient({ url: discordWebhookUrl }) : null;

  const fluxerConfig = {
    baseUrl: config.fluxer.baseUrl || 'https://api.fluxer.app',
    token: fluxerToken,
    channelId: fluxerChannelId,
    version: config.fluxer.version || '1'
  };

  const fluxerClient = new FluxerClient(fluxerConfig, async (message) => {
    if (!message || message.source !== 'fluxer') return;

    const channel = await discordClient.channels.fetch(discordChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error('Discord channel not found:', discordChannelId);
      return;
    }

    if (message.replyTo) {
      const originalDiscordId = fluxerToDiscord.get(message.replyTo);
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

    if (discordWebhook) {
      try {
        const avatarUrl = message.avatar && message.authorId ? fluxerAvatarUrl(message.authorId, message.avatar) : null;
        const sent = await discordWebhook.send({
          content: message.content,
          username: message.author,
          avatarURL: avatarUrl
        });
        discordToFluxer.set(sent.id, message.messageId);
      } catch (error) {
        console.error('Failed to send Fluxer message to Discord via webhook:', error.message || error);
      }
    } else {
      const text = `${relayPrefix} **${message.author}**: ${message.content}`;
      const sent = await channel.send({ content: text }).catch((error) => {
        console.error('Failed to send Fluxer message to Discord:', error.message || error);
      });
      if (sent) discordToFluxer.set(sent.id, message.messageId);
    }
  });

  discordClient.once('ready', async () => {
    console.log(`Discord bot logged in as ${discordClient.user.tag}`);
    await fluxerClient.start();
  });

  discordClient.on('messageCreate', async (message) => {
    if (message.author?.bot) return;
    if (!message.channel || message.channel.id !== discordChannelId) return;

    const content = message.content.trim();
    if (!content) return;

    if (message.reference) {
      const refMsgId = message.reference.messageId;
      for (const [fluxerId, discordId] of fluxerToDiscord.entries()) {
        if (discordId === refMsgId) {
          if (fluxerWebhookUrl) {
            try {
              await axios.post(fluxerWebhookUrl, {
                content: `${content}`
              });
            } catch (error) {
              console.error('Failed to send reply via Fluxer webhook:', error.message || error);
            }
          } else {
            await fluxerClient.sendMessage(fluxerChannelId, `${message.author.username}: ${content}`, {
              message_reference: fluxerId
            });
          }
          return;
        }
      }
    }

    if (fluxerWebhookUrl) {
      try {
        const res = await axios.post(fluxerWebhookUrl, {
          content: `${content}`,
          username: message.author.username,
          avatar_url: message.author.displayAvatarURL({ dynamic: true })
        });
        fluxerToDiscord.set(res.data.id, message.id);
      } catch (error) {
        console.error('Failed to send Discord message to Fluxer via webhook:', error.message || error);
      }
    } else {
      try {
        const sent = await fluxerClient.sendMessage(fluxerChannelId, `${message.author.username}: ${content}`, {
          message_reference: null
        });
        fluxerToDiscord.set(sent.id, message.id);
      } catch (error) {
        console.error('Failed to send Discord message to Fluxer:', error.message || error);
      }
    }
    console.log(`Relayed Discord message from ${message.author.username} to Fluxer.`);
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
