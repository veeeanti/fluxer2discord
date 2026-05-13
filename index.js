require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const FluxerClient = require('./bridgeClient');
const axios = require('axios');
const FormData = require('form-data');

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

// Download a file from a URL and return as Buffer
async function downloadFile(url) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'arraybuffer'
  });
  return Buffer.from(response.data);
}

// Upload files to Fluxer channel
async function uploadFilesToFluxer(fluxerClient, channelId, files, content, messageReference = null) {
  const form = new FormData();
  
  if (files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      form.append(`file${i + 1}`, files[i].buffer, {
        filename: files[i].filename,
        contentType: files[i].contentType
      });
    }
  }
  
  form.append('content', content);
  if (messageReference) {
    form.append('message_reference', messageReference);
  }
  
  const response = await fluxerClient.client.rest.post(
    `${fluxerClient.config.baseUrl}/channels/${channelId}/messages`,
    form,
    {
      headers: form.getHeaders({
        'Authorization': fluxerClient.config.token
      })
    }
  );
  return response.data;
}

// Upload files to Discord (via webhook or bot)
async function uploadFilesToDiscord(channel, webhookUrl, files, content = '') {
  const form = new FormData();
  
  if (content) {
    form.append('payload_json', JSON.stringify({
      content: content
    }));
  }
  
  for (let i = 0; i < files.length; i++) {
    form.append(`files[${i}]`, files[i].buffer, {
      filename: files[i].filename,
      contentType: files[i].contentType
    });
  }
  
  if (webhookUrl) {
    const response = await axios.post(webhookUrl, form, {
      headers: form.getHeaders()
    });
    return response.data;
  } else {
    const discordFiles = files.map(f => ({
      attachment: f.buffer,
      name: f.filename
    }));
    const sent = await channel.send({
      content: content,
      files: discordFiles
    });
    return sent;
  }
}

// Extract custom emoji URLs from Discord message content
function extractCustomEmojis(content) {
  const emojiRegex = /<a?:(\w+):(\d+)>/g;
  const emojis = [];
  let match;
  while ((match = emojiRegex.exec(content)) !== null) {
    const [, name, id] = match;
    const animated = match[0].startsWith('<a:');
    emojis.push({
      id,
      name,
      url: `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`,
      filename: `${name}.${animated ? 'gif' : 'png'}`
    });
  }
  return emojis;
}

// Extract sticker URL from Discord message
function extractStickerUrl(message) {
  if (!message.sticker) return null;
  if (message.sticker.format) {
    const ext = message.sticker.format === 3 ? 'json' : 'png';
    return {
      url: `https://cdn.discordapp.com/stickers/${message.sticker.id}.${ext}`,
      filename: `${message.sticker.name || 'sticker'}.${ext}`
    };
  }
  return null;
}

// Process Discord message: extract attachments, emojis, stickers
async function processDiscordMessageMedia(message) {
  const files = [];
  
  // Handle attachments
  for (const attachment of message.attachments) {
    try {
      const buffer = await downloadFile(attachment.url);
      files.push({
        buffer,
        filename: attachment.name || `attachment_${attachment.id}.${attachment.contentType?.split('/')[1] || 'bin'}`,
        contentType: attachment.contentType || 'application/octet-stream'
      });
    } catch (error) {
      console.error(`Failed to download attachment ${attachment.url}:`, error.message);
    }
  }
  
  // Handle custom emojis in content
  const emojis = extractCustomEmojis(message.content);
  for (const emoji of emojis) {
    try {
      const buffer = await downloadFile(emoji.url);
      files.push({
        buffer,
        filename: emoji.filename,
        contentType: 'image/png'
      });
    } catch (error) {
      console.error(`Failed to download emoji ${emoji.url}:`, error.message);
    }
  }
  
  // Handle stickers
  const sticker = extractStickerUrl(message);
  if (sticker) {
    try {
      const buffer = await downloadFile(sticker.url);
      files.push({
        buffer,
        filename: sticker.filename,
        contentType: 'image/png'
      });
    } catch (error) {
      console.error(`Failed to download sticker ${sticker.url}:`, error.message);
    }
  }
  
  return files;
}

// Process Fluxer message: extract attachments
async function processFluxerMessageMedia(message) {
  const files = [];
  
  if (message.attachments && Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      try {
        const url = attachment.url || `${message.fluxerMediaUrl} || https://fluxerusercontent.com/attachments/${attachment.id}/${attachment.filename}`;
        const buffer = await downloadFile(url);
        files.push({
          buffer,
          filename: attachment.filename || `attachment_${attachment.id}`,
          contentType: attachment.contentType || 'application/octet-stream'
        });
      } catch (error) {
        console.error(`Failed to download Fluxer attachment:`, error.message);
      }
    }
  }
  
  return files;
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
  const fluxerServerId = config.fluxer.serverId || process.env.FLUXER_SERVER_ID;
  const discordServerId = config.discord.serverId || process.env.DISCORD_SERVER_ID;

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
    if (!message || message.source !== 'fluxer') return;}

    // Find the bridge for this fluxer channel
    const bridge = bridges.find(b => b.fluxerChannelId === message.channelId);
    if (!bridge) return;

    const channel = await discordClient.channels.fetch(bridge.discordChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error(`Discord channel not found: ${bridge.discordChannelId}`);
      return;
    }

    // Handle replies
    if (message.replyTo) {
      const originalDiscordId = bridge.fluxerToDiscord.get(message.replyTo);
      if (originalDiscordId) {
        try {
          const originalMsg = await channel.messages.fetch(originalDiscordId).catch(() => null);
          if (originalMsg) {
            // Process media attachments from Fluxer message
            const files = await processFluxerMessageMedia(message);
            if (files.length > 0) {
              await uploadFilesToDiscord(channel, bridge.discordWebhookUrl, files, `${message.author}: ${message.content || ''}`);
            } else {
              await originalMsg.reply(`${message.author}: ${message.content}`);
            }
          }
        } catch (error) {
          console.error('Failed to reply to Discord message:', error.message || error);
        }
        return;
      }
    }

    // Process media from Fluxer message
    const files = await processFluxerMessageMedia(message);
    
    let sent;
    if (bridge.discordWebhookUrl) {
      try {
        const avatarUrl = message.avatar && message.authorId ? fluxerAvatarUrl(message.authorId, message.avatar) : null;
        const payload = {
          content: message.content,
          username: message.author,
          avatar_url: avatarUrl
        };
        
        if (files.length > 0) {
          const form = new FormData();
          form.append('payload_json', JSON.stringify(payload));
          for (let i = 0; i < files.length; i++) {
            form.append(`files[${i}]`, files[i].buffer, {
              filename: files[i].filename,
              contentType: files[i].contentType
            });
          }
          const response = await axios.post(bridge.discordWebhookUrl, form, {
            headers: form.getHeaders()
          });
          sent = response.data;
        } else {
          const response = await axios.post(bridge.discordWebhookUrl, payload);
          sent = response.data;
        }
        
        // Webhook doesn't return message ID consistently, use a placeholder
        const fakeDiscordId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        bridge.discordToFluxer.set(fakeDiscordId, message.messageId);
      } catch (error) {
        console.error('Failed to send Fluxer message to Discord via webhook:', error.message || error);
        return;
      }
    } else {
      const text = `**${message.author}**: ${message.content}`;
      if (files.length > 0) {
        const discordFiles = files.map(f => ({
          attachment: f.buffer,
          name: f.filename
        }));
        sent = await channel.send({ content: text, files: discordFiles }).catch((error) => {
          console.error('Failed to send Fluxer message to Discord:', error.message || error);
        });
      } else {
        sent = await channel.send({ content: text }).catch((error) => {
          console.error('Failed to send Fluxer message to Discord:', error.message || error);
        });
      }
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
    
    // Process media from Discord message (attachments, emojis, stickers)
    const files = await processDiscordMessageMedia(message);

    // Handle replies
    if (message.reference) {
      const refMsgId = message.reference.messageId;
      const originalFluxerId = bridge.discordToFluxer.get(refMsgId);
      if (originalFluxerId) {
        if (bridge.fluxerWebhookUrl) {
          try {
            // Include message_reference in webhook payload for threaded replies
            const payload = {
              content: `${message.author.username}: ${content}`,
              message_reference: originalFluxerId
            };
            
            if (files.length > 0) {
              const form = new FormData();
              form.append('payload_json', JSON.stringify(payload));
              for (let i = 0; i < files.length; i++) {
                form.append(`files[${i}]`, files[i].buffer, {
                  filename: files[i].filename,
                  contentType: files[i].contentType
                });
              }
              await axios.post(bridge.fluxerWebhookUrl, form, {
                headers: form.getHeaders()
              });
            } else {
              await axios.post(bridge.fluxerWebhookUrl, payload);
            }
          } catch (error) {
            console.error('Failed to send reply via Fluxer webhook:', error.message || error);
          }
          console.log(`Relayed Discord reply from ${message.author.username} to Fluxer via webhook.`);
        } else {
          try {
            const sent = await uploadFilesToFluxer(
              fluxerClient,
              bridge.fluxerChannelId,
              files,
              `${message.author.username}: ${content}`,
              originalFluxerId
            );
            // Map the new Fluxer reply message to the original Discord message it replied to
            if (sent && sent.id) {
              bridge.fluxerToDiscord.set(sent.id, message.id);
            }
          } catch (error) {
            console.error('Failed to send reply to Fluxer:', error.message || error);
          }
          console.log(`Relayed Discord reply from ${message.author.username} to Fluxer.`);
        }
        return;
      }
    }

    if (bridge.fluxerWebhookUrl) {
      try {
        const payload = {
          content: `${message.author.username}: ${content}`,
          username: message.author.username,
          avatar_url: message.author.displayAvatarURL({ dynamic: true })
        };
        
        let res;
        if (files.length > 0) {
          const form = new FormData();
          form.append('payload_json', JSON.stringify(payload));
          for (let i = 0; i < files.length; i++) {
            form.append(`files[${i}]`, files[i].buffer, {
              filename: files[i].filename,
              contentType: files[i].contentType
            });
          }
          res = await axios.post(bridge.fluxerWebhookUrl, form, {
            headers: form.getHeaders()
          });
        } else {
          res = await axios.post(bridge.fluxerWebhookUrl, payload);
        }
        
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
        const sent = await uploadFilesToFluxer(
          fluxerClient,
          bridge.fluxerChannelId,
          files,
          `${message.author.username}: ${content}`
        );
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


main().catch((error) => {
  console.error('Bridge startup failed:', error.message || error);
  process.exit(1);
});
