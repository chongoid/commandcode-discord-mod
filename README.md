# Command Code Discord Mod

Production Discord integration with one standalone runtime and a read-only Command Code status mod.

## What it does

- Creates an exact tracked thread from a bot mention, or works in DMs using the real channel ID.
- Queues follow-ups per conversation instead of dropping them.
- Maintains one compact live status message with current/recent tools and subagents.
- Posts the final answer separately and retries durable delivery after transient failures.
- Never replays ambiguous work after a restart.
- Exposes `/discord-status` and `/discord-sessions` in Command Code without starting a second bot.

## Safety defaults

This bot can run coding tools with the service account's filesystem access. `DISCORD_ALLOWED_USERS` is required. Wildcard access requires `DISCORD_ALLOW_ALL_USERS=true`, and unrestricted tool permission (`CMD_YOLO=true`) is opt-in. All Discord sends suppress user, role, `@here`, and `@everyone` notifications.

## Install

```bash
cd ~/.commandcode/mods/discord
cp .env.example .env
chmod 600 .env
# Set DISCORD_BOT_TOKEN and DISCORD_ALLOWED_USERS.
./install-service.sh
systemctl --user start commandcode-discord.service
```

The installer runs tests, typecheck, build, validates Node and Command Code, and installs a user service with the exact current Node binary. It never starts or restarts a live service automatically.

## Discord UX

Every accepted request gets one status message:

```text
🔵 Working · 24s
Now: shell_command · Running tests
Recent:
• ✓ read_file · src/auth.ts
• ✓ grep · refreshToken
Tools: 1 active · 8 complete · 0 failed/blocked
```

The status reaches Completed, Failed, Cancelled, or Interrupted exactly once. Final assistant text is posted below it and never overwrites the status.

Commands: `/help`, `/status`, `/sessions`, `/stats`, `/stop`, `/reset`, `/model <name>`.

## Recovery

Requests active during a service restart become interrupted with unknown outcome and are not rerun. Queued follow-ups behind them are cancelled. Already-generated final messages remain in the durable outbox and resume delivery. A stale Command Code session fails the current request; the next message starts fresh with one context-reset notice.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run verify:pack
```

Tests use fake Discord and child processes; they never connect to Discord or execute Command Code.

See [INSTALL.md](./INSTALL.md) for prerequisites, configuration, and smoke checks.
