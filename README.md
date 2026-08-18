# Command Code Discord Bot

Run Command Code (Claude-powered coding agent) right inside Discord. Mention the bot in a thread or DM to start coding — it gives you live status updates and posts the final answer when done.

## Quick start

```bash
cd ~/.commandcode/mods/discord
cp .env.example .env       # set DISCORD_BOT_TOKEN + DISCORD_ALLOWED_USERS
chmod 600 .env
./install-service.sh       # tests, builds, installs systemd service
systemctl --user start commandcode-discord.service
```

Then in Discord: `@Command Code write a React counter component`.

## What you see in Discord

Each request gets **one status message** that updates live:

```
🔵 Working · 24s
Now: shell_command · npm test
Context: turn 3 · model claude-sonnet
Last activity: 5s ago

Recent:
• ✓ read_file · src/App.tsx
• ✓ grep · useState
Tools: 1 active · 2 complete
```

When it finishes, you get the full text answer below the status. No duplicate messages, no silent hangs.

For long model responses (30+ seconds), it says `🟢 Working · Still connected — model responses can take several minutes` so you know it's not stuck.

## Recovery

If the bot restarts while an agent is running:
- The status shows `🟠 Interrupted · outcome unknown`
- No work is repeated (your original message is safe)
- Queue and metrics update correctly

Next message starts fresh.

## Commands

`/help` `/status` `/sessions` `/stats` `/stop` `/reset` `/model <name>`

## Development

```bash
npm ci
npm test          # all tests with fake Discord
npm run typecheck
npm run build
```

See [INSTALL.md](./INSTALL.md) for prerequisites.
