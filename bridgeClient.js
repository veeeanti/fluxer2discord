const {Client, GatewayDispatchEvents} = require('@discordjs/core');
const {REST} = require('@discordjs/rest');
const {WebSocketManager} = require('@discordjs/ws');
const {Routes} = require('discord-api-types/v10');
const FormData = require('form-data');

class FluxerClient {
  constructor(config) {
    this.config = config;
    this.onMessage = null;
    this.client = null;
    this.gateway = null;
  }

  async start() {
    await this._validateConfig();
    this._initializeClient();
    await this.gateway.connect();
  }

  async _validateConfig() {
    const required = ['baseUrl', 'token'];
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

      const globalName = data.author?.global_name || data.author?.username || 'Fluxer User';
      const username = data.author?.username || 'Fluxer User';
      const displayName = globalName !== username ? `${globalName} (${username})` : globalName;

      if (this.onMessage) {
        await this.onMessage({
          source: 'fluxer',
          content: data.content,
          author: displayName,
          username: username,
          globalName: data.author?.global_name,
          avatar: data.author?.avatar,
          authorId: data.author?.id,
          messageId: data.id,
          channelId: data.channel_id,
          replyTo: data.message_reference?.message_id,
          attachments: data.attachments || []
        });
      }
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

    // If files are provided (as FormData), send multipart request
    if (options.files instanceof FormData) {
      const form = options.files;
      // Add content to form if not already added
      if (!form.has('content')) {
        form.append('content', content);
      }
      // Add message_reference if provided
      if (options.message_reference) {
        form.append('message_reference', options.message_reference);
      }
      
      return this.client.rest.post(
        `${this.config.baseUrl}/channels/${channelId}/messages`,
        form,
        {
          headers: form.getHeaders({
            'Authorization': this.config.token
          })
        }
      );
    }

    // Regular JSON message
    return this.client.rest.post(Routes.channelMessages(channelId), {
      body: {
        content,
        ...(options.message_reference ? { message_reference: options.message_reference } : {}),
        ...(options.attachments ? { attachments: options.attachments } : {})
      }
    });
  }
}

module.exports = FluxerClient;
