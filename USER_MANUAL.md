# Clawbot User Manual
## Mawbolt Systems — Kyaw Zin

---

## 1. System Overview

Clawbot is a fully autonomous AI daily operations agent running 24/7 on Modal cloud infrastructure. It manages email, calendar, Telegram, LINE, Viber, tasks, and end-of-day reports on behalf of Kyaw Zin — with no human effort required.

```
┌─────────────────────────────────────────────────────┐
│                  CLAWBOT STACK                      │
│                                                     │
│  Web GUI / Chat    ←→   Modal (24/7 Cloud)          │
│  OpenClaw TUI      ←→   Node.js server.js           │
│  Zapier Zaps       ←→   OpenAI GPT-4o (Agentic)     │
│                         ↕                           │
│                    Gmail · Calendar · Telegram       │
│                    LINE · Viber                     │
└─────────────────────────────────────────────────────┘
```

**Public URL (always online):**
```
https://itsolutions-mm--clawbot-serve.modal.run
```

---

## 2. Access Points

### 2.1 Web GUI (Chat Interface)
Open in any browser — phone, tablet, or desktop:
```
https://itsolutions-mm--clawbot-serve.modal.run
```
- Chat with Clawbot AI (GPT-4o)
- View and toggle tasks
- Monitor activity log

### 2.2 OpenClaw TUI (Terminal)
Run in VS Code terminal or macOS Terminal:
```bash
openclaw tui
```
- Opens automatically on Mac login
- Connects to local OpenClaw gateway (`ws://127.0.0.1:18789`)
- Full chat interface in terminal

### 2.3 OpenClaw Web Dashboard
```
http://127.0.0.1:18789
```
- Local browser dashboard for OpenClaw gateway

---

## 3. Daily Workflow

### Morning (08:00–09:00 Yangon)
Clawbot automatically handles or you can trigger manually:

| Task | How |
|------|-----|
| Morning briefing | Type `morning briefing` in chat |
| Check overnight email | Type `check my email` |
| Review calendar | Type `what's on my calendar today` |
| Set priorities | Type `show task status` |

### During the Day
| Action | Chat command |
|--------|-------------|
| Send Telegram | `send telegram: [message]` |
| Send LINE message | `send LINE: [message]` |
| Send email | `send email to [name]: [message]` |
| Complete a task | Click ✓ in Tasks view, or type `complete task [id]` |
| Add a task | `add task: [name] in [group]` |

### End of Day (17:00–18:00 Yangon)
| Task | How |
|------|-----|
| Generate EOD report | Type `generate end-of-day report` |
| Check completion | Type `show task status` |
| Plan tomorrow | Type `schedule tomorrow's priorities` |

---

## 4. Auto Mode

Auto Mode runs **all tasks automatically** without any human input.

### Start Auto Mode
- Click **▶ Auto Mode** in the sidebar, or
- Type `start auto mode` in chat, or
- `POST https://...modal.run/api/auto/start`

### Stop Auto Mode
- Click **⏹ Stop Auto** in the sidebar, or
- Type `stop auto mode`, or
- `POST https://...modal.run/api/auto/stop`

### Reset All Tasks
- Click **↺ Reset Tasks** in the sidebar
- This marks all tasks as undone for the next cycle

---

## 5. Task Groups & IDs

| Group | IDs | Description |
|-------|-----|-------------|
| Morning | `mor-1` … `mor-8` | Daily standup, calendar, priorities |
| Email | `em-1` … `em-7` | Inbox, replies, archive |
| Telegram | `tg-1` … `tg-6` | Bot status, messages, alerts |
| LINE | `ln-1` … `ln-5` | LINE bot, messages, contacts |
| Viber | `vb-1` … `vb-5` | Viber bot, messages |
| Calendar | `cal-1` … `cal-4` | Events, scheduling |
| Security | `sec-1` … `sec-7` | Alerts, backups, access logs |
| Core | `cor-1` … `cor-8` | Projects, PRs, documentation |
| Monitor | `mon-1` … `mon-6` | Health checks, uptime |
| End of Day | `eod-1` … `eod-7` | Reports, archiving, wrap-up |

---

## 6. Messaging Channels

### Telegram
- **Bot:** Configured and active
- **Webhook:** `https://...modal.run/api/telegram/webhook`
- AI auto-reply: ON — responds to messages in English

### LINE
- **Channel:** n8n_AI(AUTOMATIC) — ID: 2008340718
- **Webhook:** `https://...modal.run/api/line/webhook`
- AI auto-reply: ON — responds in English only
- **Default user ID:** `Ua6b07f3ac1a5fb9a0bf21a6dc543a559`

### Viber
- **Status:** ⚠️ Needs auth token
- **Action:** Get token from https://partners.viber.com → paste into `viber.config.json`
- **Webhook:** `https://...modal.run/api/viber/webhook`

### Email (Gmail)
- **Account:** itsolutions.mm@gmail.com
- Scans for urgent keywords automatically
- Can send emails via AI command

### Google Calendar
- **Account:** kyawzin.ccna@gmail.com
- Reads today's events on demand

---

## 7. OpenClaw (Local AI Agent)

OpenClaw runs locally on your Mac and connects to the Clawbot server.

### Gateway
```bash
# Check status
openclaw gateway status

# View logs
tail -f ~/.openclaw/logs/gateway.log
```

The gateway starts automatically on Mac login via LaunchAgent.

### TUI Controls
| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+L` | Switch AI model |
| `Ctrl+G` | Switch agents |
| `Ctrl+P` | Session list |
| `Esc` | Stop current run |
| `Ctrl+C` | Exit TUI |

### OpenClaw Config
```
~/.openclaw/openclaw.json
```
- Model: `openai/gpt-4o`
- Gateway port: `18789`
- Agent name: Clawbot 🦞

### Workspace Files
```
~/.openclaw/workspace/
  IDENTITY.md      ← Who Clawbot is
  USER.md          ← About Kyaw Zin
  SOUL.md          ← Agent personality
  HEARTBEAT.md     ← Proactive check schedule
  AGENTS.md        ← Session startup rules
  skills/
    clawbot/
      SKILL.md     ← Full Clawbot API reference
```

---

## 8. Zapier Integrations

**Connected Apps:** Gmail · Google Calendar · Notion · Facebook Messenger · Facebook Pages · Tavily

### Webhook Config File
```
/Users/berry/Antigravity/Clawbot webiste/zapier.config.json
```

Paste Zapier Catch Hook URLs here:
```json
{
  "task_completed":    "https://hooks.zapier.com/...",
  "all_tasks_complete":"https://hooks.zapier.com/...",
  "urgent_email":      "https://hooks.zapier.com/...",
  "calendar_events":   "https://hooks.zapier.com/..."
}
```
After editing, redeploy: `modal deploy clawbot_modal.py`

### Planned Zaps
| # | Trigger | Action |
|---|---------|--------|
| 1 | Gmail urgent email | Create Clawbot task |
| 2 | Google Calendar event | Send Telegram reminder |
| 3 | Clawbot task completed | Log to Notion |
| 4 | Facebook Messenger msg | Create Clawbot task |
| 5 | Google Calendar | Add to Notion daily planner |

---

## 9. API Reference

**Base URL:** `https://itsolutions-mm--clawbot-serve.modal.run`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/state` | Full system state + all tasks |
| GET | `/api/report` | Summary report |
| GET | `/api/report/full` | Detailed EOD report |
| POST | `/api/task` | Add custom task `{name, group}` |
| POST | `/api/task/:id/toggle` | Toggle task done/undone |
| POST | `/api/auto/start` | Start auto mode |
| POST | `/api/auto/stop` | Stop auto mode |
| POST | `/api/reset` | Reset all tasks |
| POST | `/api/chat` | Chat with AI `{message}` |
| GET | `/api/chat/history` | Chat history |
| POST | `/api/chat/clear` | Clear chat history |
| GET | `/api/email/scan` | Scan urgent emails |
| POST | `/api/email/send` | Send email `{to, subject, body}` |
| GET | `/api/calendar/events` | Today's events |
| POST | `/api/telegram/send` | Send Telegram `{message}` |
| POST | `/api/line/send` | Send LINE `{message}` |
| POST | `/api/viber/send` | Send Viber `{message}` |
| GET | `/api/telegram/contacts` | Telegram contact list |
| GET | `/api/line/contacts` | LINE contact list |

---

## 10. Deployment

Clawbot runs on **Modal** and stays online 24/7 even when your Mac is off.

### Redeploy after changes
```bash
cd "/Users/berry/Antigravity/Clawbot webiste"
modal deploy clawbot_modal.py
```

### Project Files
```
/Users/berry/Antigravity/Clawbot webiste/
  server.js              ← Main Node.js backend
  index.html             ← Chat GUI
  style.css              ← GUI styles
  app.js                 ← GUI JavaScript
  clawbot_modal.py       ← Modal deployment config
  openai.config.json     ← GPT-4o API key + system prompt
  email.config.json      ← Gmail IMAP/SMTP config
  telegram.config.json   ← Telegram bot token
  clawbot_line_config.json ← LINE channel credentials
  viber.config.json      ← Viber auth token (needs setup)
  google.config.json     ← Google Calendar OAuth
  zapier.config.json     ← Zapier webhook URLs
```

### Check deployment logs
```
https://modal.com/apps/itsolutions-mm/main/deployed/clawbot
```

---

## 11. Troubleshooting

| Problem | Solution |
|---------|----------|
| GUI shows "Reconnecting…" | Refresh browser; Modal may be cold-starting |
| LINE/Telegram not replying | Check webhook URL in each platform's console |
| Email scan fails | Verify `email.config.json` credentials |
| Calendar empty | Re-authenticate Google OAuth in `google.config.json` |
| OpenClaw TUI won't start | Run `openclaw gateway status`; restart with `openclaw gateway restart` |
| Bot replies in Thai | System prompt enforces English; clear chat history and retry |
| Viber not working | Add real auth token from partners.viber.com |

---

## 12. Quick Reference

```
# Deploy
modal deploy clawbot_modal.py

# OpenClaw TUI
openclaw tui

# OpenClaw gateway
openclaw gateway status
openclaw gateway restart

# Check logs
tail -f ~/.openclaw/logs/gateway.log

# Test Clawbot API
curl https://itsolutions-mm--clawbot-serve.modal.run/api/report
```

---

*Clawbot — Mawbolt Systems | Powered by OpenAI GPT-4o + Modal + OpenClaw*
