require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const FluxerClient = require('./fluxerClient');

function loadConfig() {
  const configPath = process.argv[2] || process.env.CONFIG_PATH || 'config.json';
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found at ${absolutePath}`);
  }

  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
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
  const relayPrefix = config.relayPrefix || '[Flux2cord]';

  if (!discordToken) {
    throw new Error('Discord bot token is required in config or DISCORD_TOKEN.');
  }
  if (!discordChannelId) {
    throw new Error('Discord channel ID is required in config.discord.channelId or mappings.discordChannelId.');
  }
  if (!fluxerToken) {
    throw new Error('Fluxer bot token is required in config.fluxer.token or FLUXER_BOT_TOKEN.');
  }
  if (!fluxerChannelId) {
    throw new Error('Fluxer channel ID is required in config.fluxer.channelId or mappings.fluxerChannelId.');
  }

  const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
  });

  const fluxerConfig = {
    baseUrl: config.fluxer.baseUrl || 'https://api.fluxer.app',
    token: fluxerToken,
    channelId: fluxerChannelId,
    version: config.fluxer.version || '1'
  };

  const fluxerClient = new FluxerClient(fluxerConfig, async (message) => {
    if (!message || message.source !== 'fluxer') {
      return;
    }

    const channel = await discordClient.channels.fetch(discordChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error('Discord channel not found or is not text-based:', discordChannelId);
      return;
    }

    const text = `${relayPrefix} **${message.author}:** ${message.content}`;
    await channel.send({ content: text }).catch((error) => {
      console.error('Failed to send Fluxer message to Discord:', error.message || error);
    });
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

    try {
      await fluxerClient.sendMessage(fluxerChannelId, `${message.author.username}: ${content}`, {
        message_reference: null
      });
      console.log(`Relayed Discord message from ${message.author.username} to Fluxer.`);
    } catch (error) {
      console.error('Failed to send Discord message to Fluxer:', error.message || error);
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
