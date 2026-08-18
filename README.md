# Command Code Discord Bot

Run Command Code right inside Discord. Mention the bot in a thread or DM to start coding — it gives you live status updates and posts the final answer when done.

## Install from Command Code (one-shot, no terminal needed)

Copy and paste this into your Command Code to get started:

```text
Install the Command Code Discord mod from github.com/chongoid/commandcode-discord-mod
into ~/.commandcode/mods/discord and bring the bot up, following the INSTALL.md inside
that repo. When the service is running and verified, prompt me for my Discord key
(bot token), write it into .env, restart the service, and confirm it's ready.
```

Command Code clones the repo, reads `INSTALL.md` for the exact setup steps, installs and
starts the bot, then ends by asking you for your Discord bot key and finishing the config.

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
