# Clawbot User Manual
## itsolutions.mm — Kyaw Zin Tun

---

## 1. System Overview

Clawbot is a fully autonomous AI daily operations agent running 24/7 on Modal cloud infrastructure. It manages email, calendar, Telegram, LINE, Viber, Slack, Notion, Google Drive, tasks, and end-of-day reports — with no human effort required.

```
┌─────────────────────────────────────────────────────────────┐
│                      CLAWBOT STACK                          │
│                                                             │
│  Web GUI / Chat    ←→   Modal (24/7 Cloud)                  │
│  Telegram / LINE   ←→   Node.js server.js                   │
│  Viber / Slack     ←→   OpenAI GPT-4o (Agentic Loop)        │
│                              ↕                              │
│              Gmail · Calendar · Telegram · LINE             │
│              Viber · Slack · Notion · Google Drive          │
└─────────────────────────────────────────────────────────────┘
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
- View and manage tasks (Task Board)
- Monitor activity log
- Check integration status (Integrations tab)

---

## 3. Daily Workflow

### Morning (08:00–09:00 Yangon)

| Task | Chat command |
|------|-------------|
| Morning briefing | `morning briefing` |
| Check overnight email | `check my email` |
| Review calendar | `what's on my calendar today` |
| Set priorities | `show task status` |
| Check Notion tasks | `check notion tasks` |

### During the Day

| Action | Chat command |
|--------|-------------|
| Send Telegram message | `send telegram: [message]` |
| Send LINE message | `send LINE: [message]` |
| Send email | `send email to [name]: [message]` |
| Send Slack message | `send slack message: [message]` |
| Read Slack messages | `check slack messages` |
| Add Notion task | `add to notion: [task name]` |
| Delete Notion task | `delete [task name] in notion` |
| Find Drive file | `find [filename] in drive` |
| Upload file | Click 📎 in chat input |
| Create Drive folder | `create folder [name]` |
| Move Drive file | `move [file] to [folder]` |
| Copy Drive file | `copy [file] to [folder]` |
| Rename Drive file | `rename [file] to [new name]` |
| Delete Drive file | `delete file [name]` |

### End of Day (17:00–18:00 Yangon)

| Task | Chat command |
|------|-------------|
| Generate EOD report | `generate end-of-day report` |
| Check completion | `show task status` |
| Set reminder | `remind me to [task] at [time]` |

---

## 4. Auto Mode

Auto Mode runs **all tasks automatically** without any human input.

| Action | How |
|--------|-----|
| Start | Click **▶ Auto Mode** in sidebar, or type `start auto mode` |
| Stop | Click **⏹ Stop Auto** in sidebar, or type `stop auto mode` |
| Reset tasks | Click **↺ Reset Tasks** in sidebar |

---

## 5. Task Groups

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

## 6. Integrations

### 6.1 Telegram
- **Auto-reply:** ON — responds to ALL users in English
- **Webhook:** `https://itsolutions-mm--clawbot-serve.modal.run/api/telegram/webhook`
- **Contacts:** Persistent across restarts (stored in Modal Volume `/data/tg_contacts.json`)
- External users receive knowledge about AI automation, N8N, Make, Cloud, Network (≤80 words)

### 6.2 LINE
- **Channel:** n8n_AI(AUTOMATIC) — ID: 2008340718
- **Webhook:** `https://itsolutions-mm--clawbot-serve.modal.run/api/line/webhook`
- **Auto-reply:** ON — English only
- **Default user:** `Ua6b07f3ac1a5fb9a0bf21a6dc543a559`

### 6.3 Viber
- **Status:** Needs auth token
- Get token from https://partners.viber.com → paste into `viber.config.json`
- **Webhook:** `https://itsolutions-mm--clawbot-serve.modal.run/api/viber/webhook`

### 6.4 Slack
- **Workspace:** N8N AI Bot
- **Bot:** n8napp
- **Default channel:** `#all-n8n-ai-bot` (`C09FXJCTJRL`)
- **Config:** `slack.config.json` — `botToken` (xoxb-), `defaultChannelId`
- **Scopes required:** `chat:write`, `channels:history`, `channels:read`

### 6.5 Notion
- **Page:** Weekly To-do List
- **Page ID:** `27997eea-009f-8116-b447-d8a907938667`
- **Config:** `notion.config.json` — `apiKey`, `databaseId`
- Uses to_do block structure (columns per day: Mon–Sun)
- Supports: read tasks, add task, delete task by name

### 6.6 Google (Gmail / Drive / Calendar)
- **Gmail:** itsolutions.mm@gmail.com
- **Calendar:** kyawzin.ccna@gmail.com
- **Drive:** Full file management (search, upload, move, copy, rename, delete, create folders)
- **Config:** `google_user_token.json` (OAuth token), `gcpkyawzin*.json` (service account)

### 6.7 Facebook Messenger
- **Status:** Needs PSID (defaultRecipientId) in `facebook.config.json`
- Page Access Token must start with `EAA`

### 6.8 Email (Gmail IMAP/SMTP)
- Scans for urgent keywords automatically
- Sends emails with or without Drive attachments
- **Config:** `email.config.json`

---

## 7. Google Drive Tools

| Command | What it does |
|---------|-------------|
| `find [name] in drive` | Search all of Drive including subfolders |
| `list drive files` | Show recent or folder contents |
| `upload file` | Click 📎 button in chat (up to 50MB) |
| `send file [name] to [email]` | Find file in Drive and attach to email |
| `create folder [name]` | Create a new folder in Drive |
| `move [file] to [folder]` | Move file to a different folder |
| `copy [file] to [folder]` | Copy file into a folder |
| `rename [file] to [new name]` | Rename a file or folder |
| `delete file [name]` | Delete file from Drive |
| `create sheet [title]` | Create a new Google Sheet |
| `read sheet` | Read rows from a Google Sheet |
| `add row to sheet` | Append a row to a Google Sheet |

---

## 8. Reminders

| Command | Example |
|---------|---------|
| Set reminder | `remind me to call client at 3pm` |
| List reminders | `show reminders` |
| Cancel reminder | `cancel reminder [id]` |

Reminders fire via Telegram message + web alert.

---

## 9. Integrations Dashboard

Click the **🔌 Integrations** tab in the web GUI to:
- See live connection status for all 8 services (green = connected, grey = not configured)
- Click **Test** on Telegram, Slack, Notion, or Google to do a live API ping
- Click **↺ Refresh** to reload status

---

## 10. API Reference

**Base URL:** `https://itsolutions-mm--clawbot-serve.modal.run`

All `/api/` endpoints require header: `x-api-key: [your secret from auth.config.json]`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/state` | Full system state + all tasks |
| GET | `/api/report` | Summary report |
| POST | `/api/chat` | Chat with AI `{message}` |
| GET | `/api/chat/history` | Chat history |
| POST | `/api/chat/clear` | Clear chat history |
| POST | `/api/task` | Add custom task `{name, group}` |
| POST | `/api/task/:id/toggle` | Toggle task done/undone |
| POST | `/api/auto/start` | Start auto mode |
| POST | `/api/auto/stop` | Stop auto mode |
| POST | `/api/reset` | Reset all tasks |
| GET | `/api/email/scan` | Scan urgent emails |
| POST | `/api/email/send` | Send email `{to, subject, body}` |
| GET | `/api/calendar/events` | Today's calendar events |
| POST | `/api/telegram/send` | Send Telegram `{message}` |
| POST | `/api/line/send` | Send LINE `{message}` |
| POST | `/api/viber/send` | Send Viber `{message}` |
| GET | `/api/telegram/contacts` | Telegram contact list |
| POST | `/api/drive/upload` | Upload file to Drive (multipart) |
| GET | `/api/integrations/status` | All integration statuses |
| POST | `/api/integrations/test/:service` | Live test for telegram/slack/notion/google |
| GET | `/api/notion/debug` | Notion connection diagnostic |
| GET | `/api/log` | Recent activity log |

---

## 11. Deployment

Clawbot runs on **Modal** and stays online 24/7 even when your Mac is off.

### Redeploy after changes
```bash
cd "/Users/berry/Antigravity/Clawbot webiste"
modal deploy clawbot_modal.py
```

### Project Files
```
/Users/berry/Antigravity/Clawbot webiste/
  server.js                ← Main Node.js backend
  index.html               ← Chat GUI
  style.css                ← GUI styles
  app.js                   ← GUI JavaScript
  clawbot_modal.py         ← Modal deployment + Volume config
  package.json             ← Node dependencies
  openai.config.json       ← GPT-4o API key + system prompt
  email.config.json        ← Gmail IMAP/SMTP credentials
  telegram.config.json     ← Telegram bot token
  clawbot_line_config.json ← LINE channel credentials
  viber.config.json        ← Viber auth token
  slack.config.json        ← Slack bot token + channel ID
  notion.config.json       ← Notion API key + page ID
  facebook.config.json     ← Facebook page access token
  auth.config.json         ← Clawbot API secret key
  google_user_token.json   ← Google OAuth token (gitignored)
  gcpkyawzin*.json         ← Google service account (gitignored)
```

### Modal Volume (Persistent Storage)
Survives container restarts — stored at `/data` in the cloud:
- `/data/tg_contacts.json` — Telegram contact registry
- `/data/slack_token.json` — Refreshed Slack token cache

### Check deployment logs
```
https://modal.com/apps/itsolutions-mm/main/deployed/clawbot
```

### GitHub Repository
```
https://github.com/kyawzinIT99/AI-Personalized-
```

---

## 12. Troubleshooting

| Problem | Solution |
|---------|----------|
| GUI shows "Reconnecting…" | Refresh browser; Modal may be cold-starting |
| Telegram not replying | Check webhook URL in Telegram BotFather console |
| LINE not replying | Verify webhook at LINE Developers console |
| Notion tasks empty | Ensure integration is connected to the page at notion.so |
| Slack `token_revoked` | Reinstall Slack app → get new `xoxb-` token → update `slack.config.json` |
| Slack `missing_scope` | Add `channels:history` in Slack app OAuth & Permissions → reinstall |
| Slack `channel_not_found` | Bot not in channel — run `/invite @botname` in Slack |
| Email scan fails | Verify `email.config.json` credentials |
| Calendar empty | Re-authenticate Google OAuth |
| Drive upload fails | Check Google token in `google_user_token.json` |
| Bot replies with filler phrases | Clear chat and retry; tone rules enforce sharp responses |

---

## 13. Config File Quick Reference

| File | Key fields |
|------|-----------|
| `openai.config.json` | `apiKey`, `model`, `systemPrompt` |
| `telegram.config.json` | `botToken`, `defaultChatId` |
| `clawbot_line_config.json` | `channel.channel_access_token` |
| `viber.config.json` | `authToken` |
| `slack.config.json` | `botToken`, `defaultChannelId` |
| `notion.config.json` | `apiKey`, `databaseId` (page ID) |
| `facebook.config.json` | `pageAccessToken`, `defaultRecipientId` |
| `auth.config.json` | `apiSecret`, `chatRateLimitPerMinute` |
| `email.config.json` | `user`, `pass`, `smtp`, `imap` |

After editing any config file:
```bash
modal deploy clawbot_modal.py
```

---

## 14. Quick Reference

```bash
# Deploy
modal deploy clawbot_modal.py

# Test Notion connection
curl -H "x-api-key: [secret]" https://itsolutions-mm--clawbot-serve.modal.run/api/notion/debug

# Test all integrations
curl -H "x-api-key: [secret]" https://itsolutions-mm--clawbot-serve.modal.run/api/integrations/status

# Test Slack live
curl -X POST -H "x-api-key: [secret]" https://itsolutions-mm--clawbot-serve.modal.run/api/integrations/test/slack
```

---

*Clawbot — itsolutions.mm | Powered by OpenAI GPT-4o + Modal Cloud*
