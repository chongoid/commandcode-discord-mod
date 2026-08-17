# 🤖 commandcode-discord

> **Code from Discord.** Full Command Code sessions in threads — resumable from your terminal.

<p align="center">
  <img src="https://img.shields.io/badge/Command%20Code-Mod-purple?style=for-the-badge" alt="Command Code Mod">
  <img src="https://img.shields.io/badge/Discord.js-v14-blue?style=for-the-badge" alt="Discord.js">
</p>

## ✨ Features

- **🧵 Auto-threading** — Each `@mention` spawns an isolated thread with its own session
- **⚡ Full Agent** — Read/write files, run commands, search code — everything Command Code can do
- **🔄 Session Parity** — Every Discord session is resumable in your terminal via `cmd --resume`
- **💬 DM Support** — DM the bot for private sessions
- **📊 `/stats`** — Track requests, sessions, and errors
- **🎯 Zero Token Waste** — Thread titles from your message text, no LLM calls

---

## 📋 Prerequisites

1. **[Command Code](https://commandcode.ai)** installed
2. **A Discord bot** — create one at the [Developer Portal](https://discord.com/developers/applications)
3. **Privileged Intents enabled** — in your app → **Bot** → enable **Message Content** and **Server Members** intents → Save
4. **Bot invited** with correct permissions:
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=2147880016&scope=bot%20applications.commands
   ```

---

## 🚀 Quick Install

```bash
git clone https://github.com/chongoid/commandcode-discord.git ~/.commandcode/mods/discord \
  && cd ~/.commandcode/mods/discord \
  && npm install \
  && echo "DISCORD_BOT_TOKEN=your-token-here" > .env
```

Then run as a 24/7 service (recommended):

```bash
./install-service.sh
```

---

## 🎮 Usage

**In Discord:**
1. Mention `@YourBot` in any channel to start a session
2. Reply in the thread — no mention needed
3. Or DM the bot directly for private sessions

**In Terminal:**

```bash
cmd /discord-sessions          # List Discord sessions
cmd --resume <session-id>      # Resume one in your terminal
```

---

## ⌨️ Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Usage guide |
| `/status` | Current session info + resume command |
| `/sessions` | List all active sessions |
| `/stop` | Stop the running process |
| `/reset` | Reset this thread's session |
| `/model <name>` | Set model for new sessions |
| `/stats` | Usage statistics |

---

## 🏃 Running Modes

**Service (recommended)** — managed by systemd, auto-starts on boot, auto-restarts on crash:

```bash
./install-service.sh                              # Install
systemctl --user status commandcode-discord       # Status
journalctl --user -f -u commandcode-discord       # Logs
systemctl --user restart commandcode-discord       # Restart
```

**Manual:**

```bash
cd ~/.commandcode/mods/discord && source .env && npx tsx standalone.ts
```

**As a mod (TUI integration):**

```bash
cmd --mod ~/.commandcode/mods/discord
```

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | — | **(Required)** Bot token |
| `DISCORD_ALLOWED_USERS` | `*` | Comma-separated user IDs or `*` for all |
| `DISCORD_GUILD_ID` | all | Restrict to a specific guild |
| `CMD_WORKING_DIR` | cwd | Working directory for sessions |
| `CMD_YOLO` | `true` | Enable file writes + shell |
| `CMD_MAX_TURNS` | `100` | Max turns per session |

---

## 📄 License

MIT

---

<p align="center">
  Built with <a href="https://commandcode.ai">Command Code</a>
</p>
