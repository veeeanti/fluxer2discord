# Fluxer2Discord Bridge

Bridge between a discord channel and a fluxer channel, only works with one currently and requires a bot for both.

## Setup

0. Install requirements for local hosting:
 - node.js 
 - npm

1. Install dependencies:

```bash
npm install
```

2. Rename the example config:

```
config.example.json >> config.json
```

3. Update `config.json` with your Discord bot token, channel ID, and Fluxer server configuration.

4. Create webhooks for Tupperbox-like behavior:
   - Discord: Go to server settings > Integrations > Webhooks > New Webhook
   - Fluxer: Go to channel settings > Webhooks > New Webhook
   - Copy both URLs to each respective WebhookUrl field

5. Start the bridge:

```bash
npm start

or

node index.js
```

## Configuration

`config.json` should contain:

- `discord.token`: Discord bot token
- `discord.channelId`: Discord channel ID to bridge
- `discord.webhookUrl`: Discord webhook URL (for Tupperbox-like username/avatar display)
- `fluxer.baseUrl`: Fluxer API base URL (default: https://api.fluxer.app)
- `fluxer.token`: Fluxer bot token
- `fluxer.channelId`: Fluxer channel ID to bridge
- `fluxer.webhookUrl`: Fluxer webhook URL (for Tupperbox-like username/avatar display)
- `fluxer.version`: API version (default: "1")
- `mappings.discordChannelId`: Discord channel ID used for this bridge
- `mappings.fluxerChannelId`: Fluxer channel ID used for this bridge
- `relayPrefix`: Prefix for relayed messages (default: "[Fluxer]")

### Message Format

With webhooks configured on both sides, messages relay with sender's username and avatar.
Without webhooks, messages use the format `username: message` or `{prefix} **username**: message`.


