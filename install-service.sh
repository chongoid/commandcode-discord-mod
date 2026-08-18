#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_DIR="$HOME/.config/systemd/user"
SERVICE_NAME="commandcode-discord.service"
NODE_BIN="$(command -v node)"
NODE_MAJOR="$($NODE_BIN -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then echo "Node.js 20 or newer is required; found $($NODE_BIN --version)." >&2; exit 1; fi
if [[ ! -f "$SCRIPT_DIR/.env" ]] && [[ -z "${DISCORD_BOT_TOKEN:-}" ]]; then echo "Create $SCRIPT_DIR/.env from .env.example and set the token and allowed users." >&2; exit 1; fi
if [[ ! -f "$SCRIPT_DIR/.env" ]]; then umask 077; printf 'DISCORD_BOT_TOKEN=%s\nDISCORD_ALLOWED_USERS=%s\n' "$DISCORD_BOT_TOKEN" "${DISCORD_ALLOWED_USERS:?DISCORD_ALLOWED_USERS is required}" > "$SCRIPT_DIR/.env"; fi
chmod 600 "$SCRIPT_DIR/.env"
set -a
source "$SCRIPT_DIR/.env"
set +a
if [[ -z "${DISCORD_ALLOWED_USERS:-}" ]]; then echo "DISCORD_ALLOWED_USERS must be configured in .env." >&2; exit 1; fi
CMD_BIN="${CMD_PATH:-$HOME/.local/bin/cmd}"
if [[ ! -x "$CMD_BIN" ]] && ! command -v cmd >/dev/null 2>&1; then echo "Command Code executable not found. Set CMD_PATH in .env." >&2; exit 1; fi
cd "$SCRIPT_DIR"
if [[ -f package-lock.json ]]; then npm ci --include=dev; else npm install --include=dev; fi
npm test
npm run typecheck
npm run build
mkdir -p "$SYSTEMD_DIR"
sed "s|@NODE_BIN@|$NODE_BIN|g" "$SCRIPT_DIR/commandcode-discord.service" > "$SYSTEMD_DIR/$SERVICE_NAME"
grep -Fq "ExecStart=$NODE_BIN " "$SYSTEMD_DIR/$SERVICE_NAME"
"$NODE_BIN" --check "$SCRIPT_DIR/dist/standalone.js"
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
echo "Installed and enabled $SERVICE_NAME with $NODE_BIN. Start or restart it explicitly after review."
