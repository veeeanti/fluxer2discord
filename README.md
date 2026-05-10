# Fluxer2Discord Bridge

Bridge between a discord channel and a fluxer channel, only works with one currently and requires a bot for both.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the example config:

```bash
copy config.example.json config.json
```

3. Update `config.json` with your Discord bot token, channel ID, and Fluxer server configuration.

4. Start the bridge:

```bash
npm start
```

## Configuration

`config.json` should contain:

- `discord.token`: Discord bot token
- `discord.channelId`: Discord channel ID to bridge
- `fluxer.baseUrl`: Fluxer API base URL (default: https://api.fluxer.app)
- `fluxer.token`: Fluxer bot token
- `fluxer.channelId`: Fluxer channel ID to bridge
- `fluxer.version`: API version (default: "1")
- `mappings.discordChannelId`: Discord channel ID used for this bridge
- `mappings.fluxerChannelId`: Fluxer channel ID used for this bridge
- `relayPrefix`: Prefix for relayed messages (default: "[Flux2cord]")

### Message Format

Messages from Fluxer to Discord are formatted as: `{relayPrefix} **{username}:** {message}`

Example: `[Flux2cord] **JohnDoe:** Hello from Fluxer!`

## Notes

- The bot relays Discord messages from the configured channel into Fluxer. These messages have a prefix, [Flux2cord]. This does not apply the other way around, on Fluxer, messages just have 'username: message'.
- The .env file is likely not needed at all, as everything is handled by the config.json. I only included it in case it had any issues with getting the tokens from the json.
