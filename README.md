# 🤖 commandcode-discord

> **Turn Discord into your coding terminal.** A [Command Code](https://commandcode.ai) mod that lets you code from Discord — with full session parity, thread isolation, and24/7 uptime.

<p align="center">
  <img src="https://img.shields.io/badge/Command%20Code-Mod-purple?style=for-the-badge" alt="Command Code Mod">
  <img src="https://img.shields.io/badge/Discord.js-v14-blue?style=for-the-badge" alt="Discord.js">
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178c6?style=for-the-badge" alt="TypeScript">
</p>

---

## ✨ Features

- **🧵 Auto-threading** — Each @mention creates an isolated thread with its own session
- **⚡ Full Agent** — Read/write files, run commands, search code — everything Command Code can do
- **🔄 Session Parity** — Every Discord session is resumable in your terminal with `cmd --resume`
- **💬 DM Support** — DM the bot directly for private sessions
- **📊 Usage Stats** — Track requests, sessions, and errors with `/stats`
- **🔒 Permission Checks** — Validates bot permissions on startup
- **🧵 Thread Auto-archive** — Inactive threads archive after24 hours
- **⚡ Rate Limit Handling** — Smart queuing to avoid Discord API limits
- **🎯 Zero Token Waste** — Thread titles from user messages, no LLM calls for naming

---

## 🚀 Quick Install

Copy/paste this into your Command Code session:

```bash
# Clone the mod
git clone https://github.com/al5ina5/commandcode-discord.git ~/.commandcode/mods/discord

# Install dependencies
cd ~/.commandcode/mods/discord && npm install

# Configure your bot token
echo "DISCORD_BOT_TOKEN=your-token-here" > ~/.commandcode/mods/discord/.env

# Install as24/7 service
cd ~/.commandcode/mods/discord && ./install-service.sh
```

---

## 📋 Prerequisites

1. **Command Code** — [Install here](https://commandcode.ai)
2. **Discord Bot** — Create at [Discord Developer Portal](https://discord.com/developers/applications)
3. **Enable Privileged Intents**:
   - Go to your app → **Bot** → **Privileged Gateway Intents**
   - Enable **MESSAGE CONTENT INTENT**
   - Enable **SERVER MEMBERS INTENT**
   - Click **Save Changes**

4. **Invite bot with correct permissions**:
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=2147880016&scope=bot%20applications.commands
   ```

---

## 🎮 Usage

### In Discord

1. **Start a session** — Mention `@YourBot` in `#command-code`
2. **Continue chatting** — Reply in the thread (no @mention needed)
3. **DM directly** — Send a DM for private sessions

### In Terminal

```bash
# See all Discord sessions
cmd

/discord-sessions

# Resume a specific session
cmd --resume <session-id>
```

---

## ⌨️ Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show usage guide |
| `/status` | Current session info + resume command |
| `/sessions` | List all active sessions |
| `/stop` | Stop the running process |
| `/reset` | Reset this thread's session |
| `/model <name>` | Set model for new sessions |
| `/stats` | Show usage statistics |

---

## 🏃 Running Modes

### 24/7 Service (Recommended)

```bash
cd ~/.commandcode/mods/discord && ./install-service.sh
```

Manages with systemd — auto-starts on boot, auto-restarts on crash.

```bash
systemctl --user status commandcode-discord   # Status
journalctl --user -f -u commandcode-discord   # Logs
systemctl --user restart commandcode-discord   # Restart
```

### Manual

```bash
cd ~/.commandcode/mods/discord
source .env
npx tsx standalone.ts
```

### As a Mod (TUI integration)

```bash
cmd --mod ~/.commandcode/mods/discord
```

---

## ⚙️ Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `DISCORD_BOT_TOKEN` | — | **(Required)** Bot token |
| `DISCORD_ALLOWED_USERS` | `*` | Comma-separated user IDs or `*` |
| `DISCORD_GUILD_ID` | all | Specific guild ID |
| `CMD_WORKING_DIR` | cwd | Working directory for sessions |
| `CMD_YOLO` | `true` | Enable file writes + shell |
| `CMD_MAX_TURNS` | `100` | Max turns per session |

---

## 🏗️ Architecture

```
Discord Message → Bot → spawn `cmd -p --output-format json` → NDJSON stream → Discord Thread
```

Each thread gets an isolated headless Command Code session. Sessions persist to `~/.commandcode/discord-threads.json` and survive restarts.

---

## 🤔 FAQ

**Q: Does this already exist?**
A: No. This is a new mod built for Command Code's mod system. While Command Code has a mod architecture, no Discord integration existed before this.

**Q: Can I resume Discord sessions in my terminal?**
A: Yes! Every Discord session shows a `cmd --resume <id>` command. Run it in your terminal to continue where you left off.

**Q: Does it cost tokens?**
A: Yes — each Discord request runs a full Command Code session. Thread titles are free (from your message text).

**Q: Can I use it in DMs?**
A: Yes! DM the bot directly for private sessions.

---

## 📄 License

MIT

---

<p align="center">
  Built with <a href="https://commandcode.ai">Command Code</a>
</p>
