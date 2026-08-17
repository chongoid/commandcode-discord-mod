#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="commandcode-discord"
SERVICE_FILE="${SCRIPT_DIR}/commandcode-discord.service"
SYSTEMD_DIR="$HOME/.config/systemd/user"

echo "Installing Command Code Discord bot as a systemd service..."

# Check for DISCORD_BOT_TOKEN
if [ -z "$DISCORD_BOT_TOKEN" ]; then
  if [ -f "${SCRIPT_DIR}/.env" ]; then
    echo "Loading DISCORD_BOT_TOKEN from .env file..."
    source "${SCRIPT_DIR}/.env"
  fi
fi

if [ -z "$DISCORD_BOT_TOKEN" ]; then
  echo "Error: DISCORD_BOT_TOKEN is not set."
  echo ""
  echo "Either:"
  echo "  1. Export it: export DISCORD_BOT_TOKEN=your-token"
  echo "  2. Create ${SCRIPT_DIR}/.env with DISCORD_BOT_TOKEN=your-token"
  echo ""
  echo "See .env.example for reference."
  exit 1
fi

# Check dependencies
if ! command -v npx &> /dev/null; then
  echo "Error: npx is not installed. Install Node.js first."
  exit 1
fi

if ! command -v tsx &> /dev/null; then
  echo "Installing tsx..."
  npm install -g tsx
fi

# Create systemd directory
mkdir -p "$SYSTEMD_DIR"

# Copy and customize service file
sed "s/%i/$(whoami)/g; s|%h|$HOME|g" "$SERVICE_FILE" > "${SYSTEMD_DIR}/${SERVICE_NAME}.service"

# Create .env file if it doesn't exist
if [ ! -f "${SCRIPT_DIR}/.env" ]; then
  echo "DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}" > "${SCRIPT_DIR}/.env"
  echo "Created .env file at ${SCRIPT_DIR}/.env"
fi

# Reload systemd and enable service
systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}.service"
systemctl --user start "${SERVICE_NAME}.service"

echo ""
echo "Service installed and started!"
echo ""
echo "Commands:"
echo "  systemctl --user status ${SERVICE_NAME}       # Check status"
echo "  journalctl --user -f -u ${SERVICE_NAME}       # View logs"
echo "  systemctl --user restart ${SERVICE_NAME}       # Restart"
echo "  systemctl --user stop ${SERVICE_NAME}          # Stop"
echo ""
echo "The bot will start automatically on boot."
echo "To uninstall: systemctl --user disable --now ${SERVICE_NAME}"
