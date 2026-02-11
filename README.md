# Discord TTS Bot

Personal Discord bot with Text-to-Speech (TTS), auto-follow in voice channels, and automatic reading of voice chat messages.

## Features

- 🔊 **Text-to-Speech**: `/say` command to make the bot speak in voice channels
- 🎯 **Auto-Follow**: Automatically follows the owner between voice channels
- 💬 **Voice Chat Reading**: Automatically reads owner's messages in voice chat (fail-closed detection)
- 🔒 **Owner-Only**: All features restricted to a single owner for maximum security
- 🎭 **Multiple TTS Providers**: Support for gTTS (free) and Google Cloud TTS (optional)
- 🛡️ **Production-Ready**: Robust error handling, state management, and graceful shutdown

## Requirements

- **Node.js**: v22.0.0 or higher (ESM native support)
- **Platform**: Linux (Docker/Pterodactyl/Jexactyl) or any Node 22 compatible environment
- **Discord Bot**: Token and application ID from Discord Developer Portal

## Quick Start

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to "Bot" section and click "Add Bot"
4. Under "Token", click "Reset Token" and copy it (you'll need this)
5. Enable the following **Privileged Gateway Intents**:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Go to "OAuth2" → "URL Generator"
7. Select scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
8. Select bot permissions:
   - ✅ Send Messages
   - ✅ Connect
   - ✅ Speak
   - ✅ Use Voice Activity
9. Copy the generated URL and use it to invite the bot to your server

### 2. Get Your Owner ID

1. Enable Discord Developer Mode: Settings → Advanced → Developer Mode
2. Right-click your username and select "Copy User ID"
3. Save this ID for configuration

### 3. Installation

```bash
# Clone or download this repository
cd discord-tts-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your settings
nano .env  # or use any text editor
```

### 4. Configuration

Edit `.env` file:

```env
# REQUIRED
DISCORD_TOKEN=your_bot_token_here
OWNER_ID=your_user_id_here

# OPTIONAL (with defaults)
TTS_PROVIDER=gtts
LANG=es
MAX_TTS_CHARS=200
LOG_LEVEL=info
```

### 5. Run Locally

```bash
# Development mode (auto-reload)
npm run dev

# Production mode
npm run build
npm start
```

### 6. Deploy to Pterodactyl/Jexactyl

1. Upload all files to your panel
2. Set **Startup Command** to: `node run.js`
3. Set environment variables in the panel:
   - `DISCORD_TOKEN`
   - `OWNER_ID`
4. Start the server

The `run.js` bootstrap script will automatically:
- Verify Node version and environment
- Install dependencies
- Build TypeScript
- Start the bot

## Commands

### `/say <text>`
Make the bot speak text in your voice channel.

**Example:**
```
/say Hello everyone!
```

**Requirements:**
- You must be in a voice channel
- Only the owner can use this command

### `/stop`
Stop current TTS playback and clear the queue.

**Example:**
```
/stop
```

## Voice Chat Auto-Reading

The bot automatically reads your messages sent in the **voice chat text channel** when you're connected to voice.

### How It Works

1. Join a voice channel
2. Send a message in the associated voice chat text channel
3. Bot automatically reads your message via TTS

### Ignored Messages

- Messages starting with `.` (dot)
- Messages starting with `,` (comma)
- Messages in regular text channels (not voice chat)
- Messages when you're not in voice

### Fail-Closed Detection

The bot uses **fail-closed** detection for voice chat channels:
- Only reads messages if it's CERTAIN the channel is a voice chat
- If uncertain, it will NOT read to avoid reading from regular text channels
- This prevents accidental reading of private conversations

## TTS Providers

### gTTS (Default - Free)

Google Text-to-Speech free service. No configuration required.

**Pros:**
- No setup needed
- Free
- Works immediately

**Cons:**
- Rate-limited (may fail under heavy use)
- Limited voice options
- Requires internet connection

**Configuration:**
```env
TTS_PROVIDER=gtts
LANG=es
```

### Google Cloud TTS (Optional - Paid)

High-quality Google Cloud Text-to-Speech API.

**Pros:**
- High quality voices
- Many voice options
- Reliable (no rate limits with paid plan)
- Multiple languages and accents

**Cons:**
- Requires Google Cloud account
- Costs money (though free tier available)
- Requires credential setup

**Setup:**

1. Create a Google Cloud project
2. Enable Cloud Text-to-Speech API
3. Create a service account and download JSON key
4. Configure environment:

```env
TTS_PROVIDER=google
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
VOICE_NAME=es-ES-Standard-A
LANG=es-ES
```

**Available Spanish Voices:**
- `es-ES-Standard-A` (Female, Spain)
- `es-US-Standard-A` (Female, US)
- `es-US-Standard-B` (Male, US)
- And many more...

## Security

### Owner-Only Design

This bot implements strict owner-only security:

- **Hardcoded Owner ID**: `978783908638375956` (overridable via env)
- **All commands**: Only the owner can execute
- **All interactions**: Non-owners are silently ignored
- **Voice auto-read**: Only owner's messages are read
- **No responses to others**: Bot won't reveal its presence to non-owners

### Why This Matters

- Prevents unauthorized use of your bot
- Protects your privacy (no one else can make it speak)
- Prevents abuse/spam
- Keeps voice chat private

## Troubleshooting

### Bot Not Responding

**Check:**
1. Bot is online in Discord
2. Bot has been invited with correct permissions
3. Environment variables are set correctly
4. Check logs for errors

**Permissions needed:**
- Send Messages
- Connect (to voice)
- Speak (in voice)
- Use Voice Activity

### LibSodium Errors

```
Error: Failed to load libsodium
```

**Solutions:**
1. Ensure Node 22+ is installed: `node --version`
2. Reinstall dependencies:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```
3. Check that both packages are installed:
   ```bash
   npm list libsodium-wrappers
   npm list libsodium-wrappers-sumo
   ```

### Voice Connection Issues

**Bot joins but doesn't speak:**
- Check bot has "Speak" permission in the voice channel
- Verify owner is in the same voice channel
- Try `/stop` then `/say` again

**Bot doesn't auto-follow:**
- Verify `OWNER_ID` matches your Discord user ID
- Check bot has "Connect" permission in target channel
- Look for errors in logs

### TTS Not Working

**gTTS rate limit errors:**
- Wait a few seconds between requests
- Consider upgrading to Google Cloud TTS
- Check internet connection

**Google Cloud TTS errors:**
- Verify credentials file path is correct
- Check GOOGLE_APPLICATION_CREDENTIALS env var
- Ensure Cloud TTS API is enabled in Google Cloud Console
- Verify service account has necessary permissions

### Voice Chat Not Being Read

**Bot not reading messages:**
- Verify you're in a voice channel
- Check the message is in the voice chat text channel (not a regular channel)
- Don't start message with `.` or `,`
- Check logs to see if detection is failing

**Understanding Fail-Closed:**
The bot intentionally uses strict detection to avoid reading from wrong channels. If it's not reading:
1. This is by design for privacy
2. The channel may not be properly associated with voice
3. Check logs for "Message not from voice chat channel"

### Pterodactyl/Jexactyl Issues

**Bot won't start:**
1. Verify Node 22 is installed on the server
2. Check startup command is set to: `node run.js`
3. Ensure all environment variables are set in panel
4. Check panel console for error messages

**Startup command must be:**
```
node run.js
```

**Required environment variables in panel:**
- `DISCORD_TOKEN`
- `OWNER_ID`

## Advanced Configuration

### Voice Settings

```env
# Timeout for joining voice (milliseconds)
VOICE_JOIN_TIMEOUT=10000

# Timeout for voice ready state (milliseconds)
VOICE_READY_TIMEOUT=20000

# Maximum reconnection attempts
VOICE_MAX_RETRIES=3

# Backoff base delay (milliseconds)
VOICE_BACKOFF_BASE=1000

# Backoff max delay (milliseconds)
VOICE_BACKOFF_MAX=10000
```

### Logging

```env
# Log level: trace | debug | info | warn | error | fatal
LOG_LEVEL=info

# Pretty print logs (set to false in production for JSON logs)
LOG_PRETTY=true
```

## Architecture

### State Management

The bot uses a robust state machine for voice connections:

**States:**
- `Idle`: Not connected
- `Connecting`: Joining voice channel
- `Ready`: Connected and ready
- `Moving`: Switching channels
- `Disconnecting`: Leaving channel
- `Backoff`: Retrying after error

### Mutex/Locking

Per-guild operation locks prevent race conditions:
- Only one voice operation at a time per guild
- Prevents conflicting join/leave/move operations
- Ensures clean state transitions

### Queue System

Per-guild TTS queues:
- FIFO processing
- One audio playing at a time
- Automatic error recovery
- Anti-spam rate limiting

### Resource Cleanup

Proper cleanup prevents memory leaks:
- Voice connections destroyed on leave
- Audio players stopped and removed
- Event listeners cleaned up
- Timers cleared on shutdown

## Development

### Project Structure

```
discord-tts-bot/
├── run.js                          # Pterodactyl bootstrap
├── package.json                    # Dependencies & scripts
├── tsconfig.json                   # TypeScript config
├── .env.example                    # Environment template
├── README.md                       # This file
├── scripts/
│   └── check.js                    # Pre-flight checks
└── src/
    ├── index.ts                    # Entry point
    ├── bot.ts                      # Main bot logic
    ├── guards/
    │   └── ownerOnly.ts           # Security guards
    ├── voice/
    │   ├── voiceManager.ts        # Voice state machine
    │   └── follow.ts              # Auto-follow logic
    ├── tts/
    │   ├── queue.ts               # TTS queue system
    │   └── providers/
    │       ├── TtsProvider.ts     # Provider interface
    │       ├── GttsProvider.ts    # gTTS implementation
    │       └── GoogleCloudProvider.ts  # Google Cloud implementation
    ├── commands/
    │   ├── say.ts                 # /say command
    │   └── stop.ts                # /stop command
    ├── util/
    │   └── logger.ts              # Logging utility
    └── types/
        └── libsodium.d.ts         # TypeScript types
```

### Scripts

```bash
# Development with auto-reload
npm run dev

# Build TypeScript
npm run build

# Run compiled code
npm start

# Run pre-flight checks
npm run check
```

### Testing

```bash
# Verify everything compiles and loads
npm run check
```

## License

MIT

## Support

This is a personal bot template. For issues:

1. Check the troubleshooting section above
2. Verify all environment variables are set correctly
3. Check the logs for specific error messages
4. Ensure Node 22+ is installed

## Credits

- Built with [discord.js](https://discord.js.org/)
- Voice support via [@discordjs/voice](https://github.com/discordjs/voice)
- Encryption via [libsodium](https://github.com/jedisct1/libsodium.js)
- TTS via [gTTS](https://github.com/zlargon/google-tts) and [Google Cloud](https://cloud.google.com/text-to-speech)
