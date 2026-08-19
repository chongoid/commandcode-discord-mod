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
cp .env.example .env       # set DISCORD_BOT_TOKEN (+ optional DISCORD_ALLOWED_USERS / DISCORD_ALLOWED_ROLES)
chmod 600 .env
./install-service.sh       # tests, builds, installs systemd service
systemctl --user start commandcode-discord.service
```

By default the bot is **open** — it replies to anyone in the servers it's in. Set
`DISCORD_ALLOWED_USERS` and/or `DISCORD_ALLOWED_ROLES` in `.env` to restrict access
to specific users or roles (optional, OR'd together, and matched by role ID or name).

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

## Attachments: images & voice

You can attach images, audio (including Discord voice messages) and other files
to your message and the bot hands them to Command Code as local files:

- Attachments are downloaded to a per-message folder under
  `workingDir/.discord-attachments/<messageId>/` and referenced (by absolute
  path, type, size and kind) in the prompt so the model can read them.
- Images (`image/*`) and audio (`audio/*`, plus voice messages named with
  "voice") are labeled as such; everything else is treated as a generic file.
- Files are removed automatically when the run finishes, is cancelled, or the
  bot shuts down, so no junk accumulates on disk. `.discord-attachments/` is
  gitignored.
- Hard caps keep things safe: max 25 MB per file, downloads follow CDN redirects
  but refuse to leave `cdn.discordapp.com` / `media.discordapp.net` (SSRF
  guard), and filenames are sanitized against path traversal and prompt injection.
- If a download fails for any reason, the original CDN URL is substituted into
  the prompt so the request still proceeds instead of erroring out.

Whether the model can actually *see* an image or *hear* audio depends on the
backend model having vision/audio support — the bot's job is to fetch the file
and point the agent at it.

### Voice-message transcription (built-in, self-contained)

Voice messages (and any `audio/*` attachment) are **auto-transcribed** to text
so a text-only `cmd` model can read what was said. Transcription is local and
self-contained — a static `whisper.cpp` binary + GGML model run on your own
machine, with **no Hermes, Python, or shared-agent dependency**:

```bash
./scripts/install-whisper.sh        # one-time: downloads whisper-cli + ggml-base.bin (~150 MB)
systemctl --user restart commandcode-discord.service
```

The transcript is inserted into the prompt under a `🗣 Voice messages
(auto-transcribed)` block. Inaudible/silent notes get a clear "returned nothing
— likely silent" marker instead of fake quotes, and if the STT stack isn't set
up the audio still passes through as a file (transcription never breaks
attachments). See `INSTALL.md` for configuration options (`WHISPER_*`).

## Development

```bash
npm ci
npm test          # all tests with fake Discord
npm run typecheck
npm run build
```

See [INSTALL.md](./INSTALL.md) for prerequisites.
