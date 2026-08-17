# Installation Guide

## Prerequisites

1. **[Command Code](https://commandcode.ai)** installed
2. **A Discord bot** — create one at the [Developer Portal](https://discord.com/developers/applications)
3. **Privileged Intents** — in your app → **Bot** → scroll to **Privileged Gateway Intents** → enable:
   - ✓ **Message Content Intent**
   - ✓ **Server Members Intent**
   - Click **Save Changes**
4. **Invite the bot** with this URL (replace `YOUR_BOT_ID`):
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=2147880016&scope=bot%20applications.commands
   ```

## Quick Install (one-liner)

```bash
git clone https://github.com/chongoid/commandcode-discord-mod.git ~/.commandcode/mods/discord \
  && cd ~/.commandcode/mods/discord \
  && npm install \
  && echo "DISCORD_BOT_TOKEN=your-token-here" > .env \
  && ./install-service.sh
```

Replace `your-token-here` with your actual bot token.

## Managing the Service

```bash
systemctl --user status commandcode-discord       # Check status
journalctl --user -f -u commandcode-discord       # View logs
systemctl --user restart commandcode-discord       # Restart
systemctl --user stop commandcode-discord          # Stop
systemctl --user disable commandcode-discord       # Disable on boot
```

## Manual Run (for testing)

```bash
cd ~/.commandcode/mods/discord
source .env
npx tsx standalone.ts
```

## Uninstall

```bash
systemctl --user disable --now commandcode-discord
rm -rf ~/.commandcode/mods/discord
```
