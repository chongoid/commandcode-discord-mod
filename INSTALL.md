# Installation

## Prerequisites

- Node.js 20 or newer
- Command Code at `~/.local/bin/cmd`, configured with `CMD_PATH`, or available on `PATH`
- A Discord application with Message Content intent enabled
- Bot permissions to view/send messages, create/send in public threads, read history, and use application commands

## Configure

```bash
cd ~/.commandcode/mods/discord
cp .env.example .env
chmod 600 .env
```

Set these required values in `.env`:

```dotenv
DISCORD_BOT_TOKEN=...
DISCORD_ALLOWED_USERS=123456789
```

`DISCORD_ALLOWED_USERS` is fail-closed. To intentionally allow everyone, set both `DISCORD_ALLOWED_USERS=*` and `DISCORD_ALLOW_ALL_USERS=true`. `CMD_YOLO` defaults to false; enable it only when every authorized user may read/write files and run commands as the service account.

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
