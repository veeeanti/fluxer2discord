const {Client, GatewayDispatchEvents} = require('@discordjs/core');
const {REST} = require('@discordjs/rest');
const {WebSocketManager} = require('@discordjs/ws');
const {Routes} = require('discord-api-types/v10');

class FluxerClient {
  constructor(config, onMessage) {
    this.config = config;
    this.onMessage = onMessage;
    this.client = null;
    this.gateway = null;
  }

  async start() {
    await this._validateConfig();
    this._initializeClient();
    await this.gateway.connect();
  }

  async _validateConfig() {
    const required = ['baseUrl', 'token', 'channelId'];
    const missing = required.filter((key) => !this.config[key]);
    if (missing.length) {
      throw new Error(`Fluxer config missing: ${missing.join(', ')}`);
    }
  }

  _initializeClient() {
    const rest = new REST({
      api: this.config.baseUrl,
      version: this.config.version || '1'
    }).setToken(this.config.token);

    this.gateway = new WebSocketManager({
      intents: 0,
      rest,
      token: this.config.token,
      version: this.config.version || '1'
    });

    this.client = new Client({rest, gateway: this.gateway});

    this.client.on(GatewayDispatchEvents.MessageCreate, async ({api, data}) => {
      if (data.author?.bot) {
        return;
      }

      this.onMessage({
        source: 'fluxer',
        content: data.content,
        author: data.author?.username || 'Fluxer User',
        authorId: data.author?.id,
        messageId: data.id,
        channelId: data.channel_id
      });
    });

    this.client.on(GatewayDispatchEvents.Ready, ({data}) => {
      const {username, discriminator} = data.user;
      console.log(`Fluxer bot logged in as @${username}#${discriminator}`);
    });
  }

  async sendMessage(channelId, content, options = {}) {
    if (!this.client || !this.client.rest) {
      throw new Error('Fluxer client not initialized');
    }

    return this.client.rest.post(Routes.channelMessages(channelId), {
      body: {
        content,
        ...options
      }
    });
  }
}

module.exports = FluxerClient;
