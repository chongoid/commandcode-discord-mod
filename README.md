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

---

## 🚀 Install

Paste this into a Command Code session — it does everything:

```
Install the commandcode-discord mod from https://github.com/chongoid/commandcode-discord-mod — clone it to ~/.commandcode/mods/discord, run npm install, create a systemd service with install-service.sh, and prompt me for my Discord bot token.
```

For manual setup or prerequisites, see [INSTALL.md](./INSTALL.md).

---

## 🎮 Usage

**In Discord:**
1. Mention `@YourBot` in `#command-code` to start a session
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

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | — | **(Required)** Bot token |
| `DISCORD_ALLOWED_USERS` | `*` | Comma-separated user IDs or `*` for all |
| `DISCORD_GUILD_ID` | all | Restrict to a specific guild |
| `CMD_WORKING_DIR` | cwd | Working directory for sessions |
| `CMD_YOLO` | `true` | Enable file writes + shell |
| `CMD_MAX_TURNS` | `100` | Max turns per session |

Set these in `~/.commandcode/mods/discord/.env`.

---

## 📄 License

MIT

---

<p align="center">
  Built with <a href="https://commandcode.ai">Command Code</a>
</p>
