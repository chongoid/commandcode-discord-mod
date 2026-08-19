# Installation

## Prerequisites

- Node.js 20 or newer
- Command Code at `~/.local/bin/cmd`, configured with `CMD_PATH`, or available on `PATH`
- A Discord application with Message Content intent enabled
- Bot permissions to view/send messages, create/send in public threads, read history, and use application commands
- `ffmpeg` on `PATH` (used to transcode voice-message audio — required for voice transcription only, not for the bot to run)

### Voice transcription (optional but built-in)

Voice-message transcription is bundled and **self-contained** — it uses a local
`whisper.cpp` binary and a GGML model downloaded into `~/.commandcode/whisper/`,
with **no dependency on Hermes, Python, or any shared agent install**. Enable it
once:

```bash
./scripts/install-whisper.sh        # downloads whisper-cli + ggml-base.bin (~150 MB)
systemctl --user restart commandcode-discord.service
```

That's it. The runtime auto-detects the defaults (`~/.commandcode/whisper/bin/whisper-cli`
and `~/.commandcode/whisper/models/ggml-base.bin`). To point elsewhere or tune it,
set these in `.env` before starting:

```dotenv
# WHISPER_ENABLED=true
# WHISPER_BINARY=/path/to/whisper-cli
# WHISPER_MODEL=/path/to/ggml-base.bin
# WHISPER_DIR=/home/user/.commandcode/whisper
# WHISPER_LANGUAGE=auto
# WHISPER_TIMEOUT_MS=120000
# WHISPER_FFMPEG=ffmpeg
# WHISPER_MIN_TOKEN_PROB=0.4   # drop whisper segments whose mean per-token probability is below this (anti-hallucination)
```

If whisper isn't set up (or ffmpeg is missing), voice attachments still work —
they're passed to the agent as files exactly as before; transcription is strictly
additive and never breaks attachment handling.

## Configure

```bash
cd ~/.commandcode/mods/discord
cp .env.example .env
chmod 600 .env
```

Set these required values in `.env`:

```dotenv
DISCORD_BOT_TOKEN=...
```

Access is controlled by two **optional** allowlists. Setting neither lets the bot
reply to anyone in the servers it's in:

```dotenv
DISCORD_ALLOWED_USERS=123456789
DISCORD_ALLOWED_ROLES=admin,123456789012345678
```

`DISCORD_ALLOWED_USERS` is a comma-separated list of Discord user IDs.
`DISCORD_ALLOWED_ROLES` is a comma-separated list of role names or role IDs.
Allowed users and allowed roles are OR'd together. To intentionally allow everyone,
set both `DISCORD_ALLOWED_USERS=*` and `DISCORD_ALLOW_ALL_USERS=true`.
`CMD_YOLO` defaults to false; enable it only when every authorized user may read/write files and run commands as the service account.

Optional controls include `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_NAME`, `CMD_PATH`, `CMD_WORKING_DIR`, `CMD_MAX_TURNS`, `CMD_TIMEOUT_MS`, and custom state/lock paths.

## Install and verify

```bash
./install-service.sh
systemctl --user start commandcode-discord.service
```

The installer:

1. validates the current Node binary and Command Code executable;
2. enforces mode `0600` on `.env`;
3. installs dependencies, runs tests/typecheck/build;
4. installs the service with the exact validated Node path;
5. enables but does not start or restart the service.

```bash
systemctl --user status commandcode-discord.service
journalctl --user -u commandcode-discord.service -f
systemctl --user restart commandcode-discord.service
systemctl --user stop commandcode-discord.service
```

## Recovery behavior

Production state defaults to `~/.commandcode/discord-runtime.json`. Legacy `~/.commandcode/discord-threads.json` is read non-destructively once. Active legacy or restart-interrupted work is marked unknown and never replayed. Completed final messages resume from the durable outbox with stable Discord nonces.

## Smoke checks

Exercise a guild mention/new thread, exact existing starter thread, tracked follow-up, rapid FIFO follow-ups, DM, attachments, parallel tools, subagent run, tool denial/error, `/stop`, `/reset`, stale session, restart during execution, and restart during final delivery. Confirm one informative status per request, a separate final answer, inert mentions, no duplicate prompt execution, and no stuck typing.
