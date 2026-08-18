# Command Code Discord Bot

Run Command Code right inside Discord. Mention the bot in a thread or DM to start coding — it gives you live status updates and posts the final answer when done.

## Install from Command Code (one-shot, no terminal needed)

Copy and paste this into your Command Code to get started:

```text
You are installing the Command Code Discord mod and bringing it up as a live bot.
Do the entire install with your tools, and only stop to ask me for the Discord key at the very end.

1. Make sure the code is at ~/.commandcode/mods/discord
   (git clone https://github.com/chongoid/commandcode-discord-mod.git, or git pull if it's already there).
2. cd into it and prepare env: cp .env.example .env && chmod 600 .env
3. Verify prerequisites: Node.js >= 20 (node -v) and Command Code on PATH (command -v cmd).
4. Create a placeholder .env so the installer can run:
   DISCORD_BOT_TOKEN= (empty) and DISCORD_ALLOWED_USERS=<my Discord user ID if you know it, else empty>.
   We will fill the real values in at the end.
5. Run ./install-service.sh (installs deps, runs tests, typechecks, builds, installs the systemd service)
   and fix anything it flags.
6. Start it: systemctl --user enable --now commandcode-discord.service
7. Confirm it is ready: systemctl --user status commandcode-discord.service shows active,
   and journalctl --user -u commandcode-discord.service shows "Command Code Discord runtime ready".

Once the service is confirmed running, then prompt me for my Discord key (the bot token from the
Discord developer portal) and my Discord user ID if you still need it. Then write the real
DISCORD_BOT_TOKEN and DISCORD_ALLOWED_USERS into ~/.commandcode/mods/discord/.env, chmod 600,
restart the service, and confirm "runtime ready" again before telling me you're all set.
```

The installer prompt walks Command Code through setting up the repo, dependencies, and systemd
service by itself, then asks you for your Discord bot key and finishes the configuration.

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

The conversation **streams into Discord live, just like the TUI**. Each assistant
reply gets its own message and grows in place as the model writes it, each tool
call gets its own message, and a compact log tracks retries and subagent work:

```text
🔧 shell_command · Group running containers by prefix
✅ shell_command · Count running containers
💬 Here's what's currently running — 136 live containers …
```

- `🔧`/`✅`/`❌` lines are individual tool calls (running / done / failed)
- `💬` assistant replies stream in live, one message per turn, so you read along as it answers
- `↻ model retry` notices collect in a small log message instead of spamming
- When it finishes, a `✅ Completed` marker appears and the full final answer posts below

For long model calls it keeps streaming and shows a `Still connected` note so you know it's not stuck.

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
