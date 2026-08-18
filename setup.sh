#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

echo "┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓"
echo "┃  Command Code Discord Mod — Interactive Setup      ┃"
echo "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛"
echo ""
echo "This will configure your Discord bot token and authorized users."
echo "For full details, see: https://github.com/chongoid/commandcode-discord-mod/blob/main/INSTALL.md"
echo ""

# --- 1. Discord Bot Token ---
if [[ -f "$ENV_FILE" ]] && grep -q '^DISCORD_BOT_TOKEN=' "$ENV_FILE"; then
  EXISTING_TOKEN=$(grep '^DISCORD_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  echo "Discord Bot Token is already configured."
  read -rp "  Replace it? [y/N]: " REPLACE_TOKEN
  if [[ "$REPLACE_TOKEN" =~ ^[Yy]$ ]]; then
    read -rp "  Paste your Discord bot token: " BOT_TOKEN
  else
    BOT_TOKEN="$EXISTING_TOKEN"
  fi
else
  read -rp "1. Paste your Discord bot token: " BOT_TOKEN
fi

if [[ -z "$BOT_TOKEN" ]]; then
  echo "✗ Error: Discord bot token is required."
  exit 1
fi

echo ""

# --- 2. Authorized Users ---
echo "2. Authorized Discord User IDs"
echo "   Only these users can send code execution requests."
echo "   Find your Discord user ID: enable Developer Mode in Discord"
echo "   (User Settings → Advanced → Developer Mode), right-click your"
echo "   profile in chat, and click 'Copy User ID'."
echo ""

if [[ -f "$ENV_FILE" ]] && grep -q '^DISCORD_ALLOWED_USERS=' "$ENV_FILE"; then
  EXISTING_USERS=$(grep '^DISCORD_ALLOWED_USERS=' "$ENV_FILE" | cut -d= -f2-)
  echo "   Currently configured: $EXISTING_USERS"
  read -rp "  Add more user IDs (comma-separated, or press Enter to keep existing): " NEW_USERS
  if [[ -n "$NEW_USERS" ]]; then
    ALL_USERS="$EXISTING_USERS,$NEW_USERS"
  else
    ALL_USERS="$EXISTING_USERS"
  fi
else
  read -rp "  Enter Discord user ID(s) (comma-separated): " ALL_USERS
fi

if [[ -z "$ALL_USERS" ]]; then
  echo "✗ Error: At least one authorized user ID is required."
  exit 1
fi

# Clean up user IDs (remove spaces, ensure comma-separated)
ALL_USERS_CLEAN=$(echo "$ALL_USERS" | tr -d ' ' | sed 's/,$//')
if [[ -z "$ALL_USERS_CLEAN" ]]; then
  echo "✗ Error: No valid user IDs entered."
  exit 1
fi

echo ""
echo "   Authorized users: $ALL_USERS_CLEAN"

# --- 3. Optional: Allow all users in a guild ---
echo ""
read -rp "3. Restrict to a specific guild? (Enter guild ID, or leave blank for global mentions): " GUILD_ID

# --- 4. Optional: Channel name ---
echo ""
read -rp "4. Channel name for the bot (default: any channel the bot can see): " CHANNEL_NAME

# --- 5. Optional: CMD path ---
echo ""
CMD_DEFAULT="$HOME/.local/bin/cmd"
if [[ -x "$CMD_DEFAULT" ]]; then
  CMD_SUGGESTED="$CMD_DEFAULT"
else
  CMD_SUGGESTED=""
fi
read -rp "5. Command Code executable path [$CMD_DEFAULT]: " CMD_PATH_INPUT
CMD_PATH="${CMD_PATH_INPUT:-$CMD_DEFAULT}"
if [[ ! -x "$CMD_PATH" ]]; then
  echo "⚠ Warning: '$CMD_PATH' is not executable or does not exist."
  read -rp "  Continue anyway? [y/N]: " CONTINUE_ANYWAY
  if [[ ! "$CONTINUE_ANYWAY" =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# --- 6. Optional: Working directory ---
echo ""
read -rp "6. Working directory for code execution (default: home dir): " WORKING_DIR
WORKING_DIR="${WORKING_DIR:-$HOME}"

# --- 7. Optional: YOLO mode ---
echo ""
echo "7. Tool permission mode:"
echo "   [1] Restricted — bot asks before running dangerous tools (recommended)"
echo "   [2] YOLO — bot runs all tools without asking (requires all authorized"
echo "       users to be fully trusted with filesystem + shell access)"
read -rp "   Select [1/2]: " YOLO_CHOICE
if [[ "$YOLO_CHOICE" == "2" ]]; then
  CMD_YOLO="true"
  echo "⚠️  YOLO mode enabled — all authorized users can read/write files and run commands."
else
  CMD_YOLO="false"
fi

# --- 8. Write .env ---
echo ""
echo "Writing configuration to $ENV_FILE ..."

umask 077
cat > "$ENV_FILE" <<EOF
DISCORD_BOT_TOKEN=$BOT_TOKEN
DISCORD_ALLOWED_USERS=$ALL_USERS_CLEAN
DISCORD_ALLOW_ALL_USERS=false
$([[ -n "$GUILD_ID" ]] && echo "DISCORD_GUILD_ID=$GUILD_ID")
$([[ -n "$CHANNEL_NAME" ]] && echo "DISCORD_CHANNEL_NAME=$CHANNEL_NAME")
CMD_PATH=$CMD_PATH
CMD_WORKING_DIR=$WORKING_DIR
CMD_YOLO=$CMD_YOLO
CMD_MAX_TURNS=100
CMD_TIMEOUT_MS=1800000
EOF
chmod 600 "$ENV_FILE"

echo ""
echo "✓ Configuration written to $ENV_FILE (mode 0600)"
echo ""
echo "Next steps:"
echo "  1. Review INSTALL.md for prerequisites"
echo "  2. Run ./install-service.sh to install the systemd service"
echo "  3. systemctl --user start commandcode-discord.service"
echo "  4. In Discord: @Command Code <your message here>"
echo ""
