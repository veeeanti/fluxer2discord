# Fluxer2Discord Bridge

Bridge between Discord and Fluxer channels with support for multiple channel mappings and threaded replies.

## Features

- **Multiple channel mappings**: Pair multiple Discord channels with multiple Fluxer channels
- **Per-mapping webhooks**: Configure separate webhooks for each channel pair
- **Threaded replies**: Replies on either platform are correctly threaded to the original message
- **Username/avatar preservation**: When using webhooks, original sender's identity is preserved
- **Media support**: Images, videos, GIFs, custom emojis, and stickers are automatically bridged

## Setup

0. Install requirements for local hosting:
  - node.js
  - npm

1. Install dependencies:

```bash
npm install
```

2. Rename the example config:

```bash
cp config.example.json config.json
```

3. Update `config.json` with your Discord bot token and Fluxer server configuration.

4. Create webhooks for Tupperbox-like behavior (recommended):
   - **Discord**: Go to server settings > Integrations > Webhooks > New Webhook
   - **Fluxer**: Go to channel settings > Webhooks > New Webhook
   - Copy both URLs to the appropriate webhook fields in the config

5. Start the bridge:

```bash
npm start

or

node index.js
```

## Configuration

`config.json` supports the following structure:

```json
{
  "discord": {
    "token": "YOUR_DISCORD_BOT_TOKEN",
    "webhookUrl": "https://discord.com/api/webhooks/..."
  },
  "fluxer": {
    "baseUrl": "https://api.fluxer.app",
    "token": "YOUR_FLUXER_BOT_TOKEN",
    "version": "1",
    "webhookUrl": "https://api.fluxer.app/webhooks/..."
  },
  "mappings": [
    {
      "discordChannelId": "DISCORD_CHANNEL_ID_1",
      "fluxerChannelId": "FLUXER_CHANNEL_ID_1",
      "fluxerWebhookUrl": "https://api.fluxer.app/webhooks/...",
      "discordWebhookUrl": "https://discord.com/api/webhooks/..."
    },
    {
      "discordChannelId": "DISCORD_CHANNEL_ID_2",
      "fluxerChannelId": "FLUXER_CHANNEL_ID_2"
    }
  ]
}
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `discord.token` | string | Discord bot token (required) |
| `discord.webhookUrl` | string | Default Discord webhook URL (optional, can be overridden per mapping) |
| `fluxer.token` | string | Fluxer bot token (required) |
| `fluxer.baseUrl` | string | Fluxer API base URL (default: `https://api.fluxer.app`) |
| `fluxer.webhookUrl` | string | Default Fluxer webhook URL (optional, can be overridden per mapping) |
| `fluxer.version` | string | API version (default: `"1"`) |
| `mappings` | array | List of channel pair mappings |

### Mapping Options

Each mapping in the `mappings` array can include:

**Note**: Channel IDs are defined only in the `mappings` array. The top-level `discord.channelId` and `fluxer.channelId` fields (shown in older examples) are **not used** by the bridge.

| Option | Type | Description |
|--------|------|-------------|
| `discordChannelId` | string | Discord channel ID (required) |
| `fluxerChannelId` | string | Fluxer channel ID (required) |
| `discordWebhookUrl` | string | Discord webhook URL for this mapping (optional, falls back to `discord.webhookUrl`) |
| `fluxerWebhookUrl` | string | Fluxer webhook URL for this mapping (optional, falls back to `fluxer.webhookUrl`) |

**Note**: Webhooks are recommended for proper username/avatar display. Without webhooks, messages are formatted as `**username:** message`.

## How It Works

1. The bridge connects to both Discord and Fluxer using bot tokens.
2. For each mapping, messages from one platform are relayed to the corresponding channel on the other platform.
3. When a user replies to a bridged message, the reply is correctly threaded to the original message on the other platform.
4. Message ID mappings are maintained in memory to track which messages correspond to each other across platforms.

### Reply Handling

- **Fluxer → Discord**: When a Fluxer user replies to a bridged message, the reply appears as a reply to the original Discord message.
- **Discord → Fluxer**: When a Discord user replies to a bridged message, the reply appears as a reply to the original Fluxer message (when using the Fluxer API; webhook replies are sent as regular messages due to webhook limitations).

### Media Support

The bridge automatically handles media attachments:

- **Images, videos, GIFs**: Downloaded from the source and re-uploaded to the destination
- **Custom Discord emojis**: Converted to static/animated PNG images and sent as attachments
- **Stickers**: Downloaded and sent as image attachments

Media files are processed asynchronously and sent along with the message content.

### Message ID Mapping

The bridge maintains two maps per channel pair:
- `discordToFluxer`: Discord message ID → Fluxer message ID
- `fluxerToDiscord`: Fluxer message ID → Discord message ID

These maps enable correct reply threading across platforms.


