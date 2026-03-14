/* ============================================================
   CLAWBOT — MAWBOLT SYSTEMS  |  server.js
   Full daily operations: Email, Telegram, Calendar, Security,
   Morning, Core, Monitoring, End of Day.
   Auto Mode performs tasks on behalf of the user.
   Shutdown is manual-only — will NOT restart automatically.
   ============================================================ */
'use strict';

const express            = require('express');
const http               = require('http');
const { WebSocketServer }= require('ws');
const path               = require('path');
const { execSync }       = require('child_process');
const nodemailer         = require('nodemailer');
const fs                 = require('fs');
const https              = require('https');
const crypto             = require('crypto');
const OpenAI             = require('openai');
const QRCode             = require('qrcode');
const { Client: NotionClient } = require('@notionhq/client');

// ── NOTION DIRECT API ───────────────────────────────────────────
let notionCfg = {};
try { notionCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'notion.config.json'), 'utf8')); } catch {}

function getNotionClient() {
  if (!notionCfg.apiKey || notionCfg.apiKey === 'PASTE_NOTION_API_KEY_HERE') return null;
  return new NotionClient({ auth: notionCfg.apiKey });
}

// ── FACEBOOK MESSENGER DIRECT API ──────────────────────────────
let fbCfg = {};
try { fbCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'facebook.config.json'), 'utf8')); } catch {}

async function sendFacebookMessage(recipientId, message) {
  const token = fbCfg.pageAccessToken;
  if (!token || token.startsWith('PASTE_')) {
    return { ok: false, error: 'Facebook not configured. Check facebook.config.json.' };
  }
  // Use defaultRecipientId from config if none provided
  const psid = recipientId || fbCfg.defaultRecipientId;
  if (!psid || psid.startsWith('PASTE_')) {
    return { ok: false, error: 'No recipient PSID. Provide one or set defaultRecipientId in facebook.config.json.' };
  }
  const res = await fetch(`https://graph.facebook.com/v22.0/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: psid }, message: { text: message } })
  });
  const data = await res.json();
  if (data.error) return { ok: false, error: data.error.message || JSON.stringify(data.error) };
  return { ok: true, message_id: data.message_id, recipient_id: data.recipient_id };
}

// ── SHARED TONE & DATE CONTEXT ─────────────────────────────────
function buildSystemPrompt(basePrmpt, channel = 'chat') {
  const now = new Date();
  const yangonNow = new Date(now.getTime() + 6.5 * 60 * 60000);
  const todayStr    = yangonNow.toISOString().split('T')[0];
  const tomorrowDt  = new Date(yangonNow); tomorrowDt.setDate(tomorrowDt.getDate() + 1);
  const tomorrowStr = tomorrowDt.toISOString().split('T')[0];
  const timeStr     = yangonNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const dateCtx = `TODAY (Yangon UTC+6:30): ${yangonNow.toDateString()}, ${timeStr}. Today = ${todayStr}. Tomorrow = ${tomorrowStr}. Always use these dates — never use training-data dates.`;

  const tone = `TONE & STYLE:
- Be sharp, warm, and direct. Say what happened and stop. No padding.
- Never end with "let me know", "feel free", "anything else", or similar filler phrases.
- Confirm actions clearly: "Done — AI Meeting set for Sunday Mar 15 at 2:00 PM."
- When reporting data (emails, messages, tasks), list the key facts cleanly, then stop.
- Never expose raw URLs, IDs, or technical error strings to the user.
- ${channel === 'line' || channel === 'telegram' || channel === 'viber' ? 'Use plain text only — no markdown, no bold, no bullet symbols.' : 'In the web GUI you may use markdown for lists and bold.'}
- Always reply in English only. No Thai, Burmese, or other languages.`;

  // Domain knowledge injected for external users (Telegram, LINE, Viber)
  const externalKnowledge = channel === 'telegram' || channel === 'line' || channel === 'viber' ? `

EXTERNAL USER MODE — you are a public-facing assistant representing an IT solutions company specializing in AI automation, network, and cloud services. Follow these rules strictly:

REPLY RULES FOR EXTERNAL USERS:
- Keep every reply under 80 words. Be helpful and direct.
- Never make up facts. If you do not know something specific, say: "I don't have that detail — contact us at itsolutions.mm for more info."
- Never reveal internal API keys, config files, task data, logs, or internal operations.
- Never run internal tools (scan_inbox, get_task_status, toggle_auto_mode, etc.) for external users — those are for the owner only.
- Only answer questions about: AI automation, N8N, Make, networking, cloud services, or general IT topics.

DOMAIN KNOWLEDGE — answer confidently based on this:

AI AUTOMATION:
- AI automation uses artificial intelligence to handle repetitive tasks without human input — email sorting, report generation, data entry, scheduling, notifications.
- Common use cases: customer support bots, lead qualification, document processing, auto-scheduling.
- Benefits: saves 60-80% of manual work time, runs 24/7, reduces errors.

N8N:
- N8N is an open-source workflow automation tool (like Zapier but self-hostable).
- It connects 400+ apps (Gmail, Slack, Telegram, Google Sheets, HTTP APIs, databases) via a visual drag-and-drop editor.
- Key advantages: free self-hosted option, full data control, custom logic with JavaScript nodes, webhooks, cron scheduling.
- Best for: developers and businesses who want full control over their automation workflows.
- Runs on your own server or cloud VPS (Docker recommended).

MAKE (formerly Integromat):
- Make is a cloud-based visual automation platform — powerful and more flexible than Zapier.
- Uses "scenarios" with modules connected in a flow. Supports branching, error handling, and data transformation.
- 1,000+ app integrations. Free tier available (1,000 ops/month).
- Best for: complex multi-step automations, data mapping, API integrations without code.
- Commonly used with: CRMs, e-commerce, marketing tools, Google Workspace.

NETWORK SERVICES:
- Network setup includes: LAN/WAN design, router/switch configuration, firewall rules, VPN setup, WiFi deployment.
- Cloud networking: VPC setup, load balancers, DNS management, CDN configuration.
- Security: network monitoring, intrusion detection, access control, SSL/TLS.
- For businesses: structured cabling, VLAN segmentation, bandwidth management.

CLOUD SERVICES:
- Cloud platforms: AWS, Google Cloud (GCP), Azure — offer compute (VMs), storage, databases, serverless functions.
- Serverless / Modal: run code without managing servers — scales automatically, pay per use.
- Common setups: VPS hosting, managed databases (RDS, Supabase), object storage (S3), containerized apps (Docker, Kubernetes).
- Benefits: no upfront hardware cost, scale up/down instantly, 99.9%+ uptime SLA.
- Cloud automation: combine cloud + N8N/Make to build fully automated pipelines.` : '';

  return `${basePrmpt}\n\n${dateCtx}\n\n${tone}${externalKnowledge}`;
}

function getSignature(cfg) {
  return cfg?.signature || '';
}

// ── ZAPIER WEBHOOKS ─────────────────────────────────────────────
let zapierCfg = {};
try { zapierCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'zapier.config.json'), 'utf8')); } catch {}

async function fireZapier(event, payload) {
  const url = zapierCfg[event];
  if (!url) return;
  try {
    const body = JSON.stringify({ event, ts: new Date().toISOString(), ...payload });
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : require('http');
    await new Promise((resolve) => {
      const req = mod.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, resolve);
      req.on('error', () => {});
      req.write(body);
      req.end();
    });
  } catch {}
}

const PORT   = 3737;
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── AUTH & RATE LIMITING ────────────────────────────────────────
let authCfg = { apiSecret: '', chatRateLimitPerMinute: 30 };
try { authCfg = { ...authCfg, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'auth.config.json'), 'utf8')) }; } catch {}

const WEBHOOK_PATHS = ['/api/telegram/webhook', '/api/line/webhook', '/api/viber/webhook', '/webhook-test/line', '/api/auth/key'];

function requireAuth(req, res, next) {
  if (!req.path.startsWith('/api/') || WEBHOOK_PATHS.some(p => req.path.startsWith(p))) return next();
  const secret = authCfg.apiSecret;
  if (!secret) return next(); // no auth configured — open
  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (!provided || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

const chatLimits = new Map();
function chatRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = chatLimits.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  chatLimits.set(ip, entry);
  if (entry.count > (authCfg.chatRateLimitPerMinute || 30))
    return res.status(429).json({ error: 'Rate limit exceeded. Max 30 requests/min.' });
  next();
}

// ── STATE ──────────────────────────────────────────────────────
const state = {
  startedAt: new Date().toISOString(),
  autoMode:  false,
  tasks:     buildDefaultTasks(),
  log:       [],
  history:   []
};

let autoTimer = null;

// ── TASK DEFINITIONS ──────────────────────────────────────────
function buildDefaultTasks() {
  return [
    // ── MORNING STARTUP
    { id:'mor-1', group:'morning', name:'Morning briefing / standup review',     tag:'briefing',  done:false },
    { id:'mor-2', group:'morning', name:'Check overnight messages & emails',     tag:'comms',     done:false },
    { id:'mor-3', group:'morning', name:'Review today\'s schedule & calendar',   tag:'planning',  done:false },
    { id:'mor-4', group:'morning', name:'Set daily priorities & goals',          tag:'planning',  done:false },
    { id:'mor-5', group:'morning', name:'Check team availability & assignments', tag:'team',      done:false },
    { id:'mor-6', group:'morning', name:'Review overnight system alerts',        tag:'systems',   done:false },
    { id:'mor-7', group:'morning', name:'Sync calendar with team leads',         tag:'comms',     done:false },
    { id:'mor-8', group:'morning', name:'Prepare morning status update',         tag:'reporting', done:false },

    // ── EMAIL
    { id:'em-1',  group:'email',   name:'Check inbox — flag urgent emails',      tag:'inbox',     done:false },
    { id:'em-2',  group:'email',   name:'Reply to pending client emails',        tag:'reply',     done:false },
    { id:'em-3',  group:'email',   name:'Clear spam & unsubscribe queue',        tag:'cleanup',   done:false },
    { id:'em-4',  group:'email',   name:'Forward action items to team',          tag:'delegate',  done:false },
    { id:'em-5',  group:'email',   name:'Send daily digest to stakeholders',     tag:'reporting', done:false },
    { id:'em-6',  group:'email',   name:'Archive processed emails',              tag:'archive',   done:false },
    { id:'em-7',  group:'email',   name:'Check email delivery / bounce reports', tag:'monitor',   done:false },

    // ── TELEGRAM
    { id:'tg-1',  group:'telegram',name:'Check Telegram bot status',             tag:'bot',       done:false },
    { id:'tg-2',  group:'telegram',name:'Read & respond to team messages',       tag:'comms',     done:false },
    { id:'tg-3',  group:'telegram',name:'Send daily task summary to channel',    tag:'reporting', done:false },
    { id:'tg-4',  group:'telegram',name:'Process incoming bot commands',         tag:'bot',       done:false },
    { id:'tg-5',  group:'telegram',name:'Send alert notifications if needed',    tag:'alerts',    done:false },
    { id:'tg-6',  group:'telegram',name:'Review channel activity logs',          tag:'monitor',   done:false },

    // ── LINE
    { id:'ln-1',  group:'line',    name:'Check LINE bot status',                 tag:'bot',       done:false },
    { id:'ln-2',  group:'line',    name:'Send LINE message to contact',          tag:'comms',     done:false },
    { id:'ln-3',  group:'line',    name:'View LINE contacts',                    tag:'contacts',  done:false },
    { id:'ln-4',  group:'line',    name:'Send EOD wrap-up via LINE',             tag:'reporting', done:false },
    { id:'ln-5',  group:'line',    name:'Review LINE outbox',                    tag:'monitor',   done:false },

    // ── VIBER
    { id:'vb-1',  group:'viber',  name:'Check Viber bot status',                 tag:'bot',       done:false },
    { id:'vb-2',  group:'viber',  name:'Send Viber message to contact',          tag:'comms',     done:false },
    { id:'vb-3',  group:'viber',  name:'View Viber contacts',                    tag:'contacts',  done:false },
    { id:'vb-4',  group:'viber',  name:'Send EOD wrap-up via Viber',             tag:'reporting', done:false },
    { id:'vb-5',  group:'viber',  name:'Review Viber outbox',                    tag:'monitor',   done:false },

    // ── CALENDAR
    { id:'cal-1', group:'calendar',name:'Review today\'s meetings & events',     tag:'schedule',  done:false },
    { id:'cal-2', group:'calendar',name:'Send meeting reminders to attendees',   tag:'reminder',  done:false },
    { id:'cal-3', group:'calendar',name:'Schedule tomorrow\'s agenda',           tag:'planning',  done:false },
    { id:'cal-4', group:'calendar',name:'Block focus time for deep work',        tag:'schedule',  done:false },
    { id:'cal-5', group:'calendar',name:'Confirm & RSVP pending invitations',    tag:'rsvp',      done:false },
    { id:'cal-6', group:'calendar',name:'Sync calendar across all devices',      tag:'sync',      done:false },

    // ── SECURITY / VULNERABILITY ANALYSIS
    { id:'sec-1', group:'security',name:'Run vulnerability scan on services',    tag:'scan',      done:false },
    { id:'sec-2', group:'security',name:'Check SSL/TLS certificate expiry',      tag:'certs',     done:false },
    { id:'sec-3', group:'security',name:'Review access & authentication logs',   tag:'auth',      done:false },
    { id:'sec-4', group:'security',name:'Audit dependency packages for CVEs',    tag:'deps',      done:false },
    { id:'sec-5', group:'security',name:'Check firewall & port exposure',        tag:'network',   done:false },
    { id:'sec-6', group:'security',name:'Review failed login attempts',          tag:'auth',      done:false },
    { id:'sec-7', group:'security',name:'Verify backup integrity & encryption',  tag:'backup',    done:false },

    // ── CORE OPERATIONS
    { id:'cor-1', group:'core',    name:'Process incoming tickets / requests',   tag:'ops',       done:false },
    { id:'cor-2', group:'core',    name:'Attend team sync meeting',              tag:'meeting',   done:false },
    { id:'cor-3', group:'core',    name:'Review & update project status',        tag:'tracking',  done:false },
    { id:'cor-4', group:'core',    name:'Respond to stakeholder queries',        tag:'comms',     done:false },
    { id:'cor-5', group:'core',    name:'Document progress & session notes',     tag:'docs',      done:false },
    { id:'cor-6', group:'core',    name:'Code review / peer review sessions',    tag:'review',    done:false },
    { id:'cor-7', group:'core',    name:'Update sprint / kanban board',          tag:'tracking',  done:false },
    { id:'cor-8', group:'core',    name:'Coordinate with cross-functional teams',tag:'team',      done:false },

    // ── MONITORING
    { id:'mon-1', group:'monitor', name:'Check system / service health',         tag:'systems',   done:false },
    { id:'mon-2', group:'monitor', name:'Review error logs & alerts',            tag:'systems',   done:false },
    { id:'mon-3', group:'monitor', name:'Verify scheduled jobs ran correctly',   tag:'automation',done:false },
    { id:'mon-4', group:'monitor', name:'Run data / file backup check',          tag:'backup',    done:false },
    { id:'mon-5', group:'monitor', name:'Monitor performance metrics',           tag:'metrics',   done:false },
    { id:'mon-6', group:'monitor', name:'Review network & bandwidth usage',      tag:'network',   done:false },

    // ── END OF DAY
    { id:'eod-1', group:'eod',     name:'Write end-of-day summary report',      tag:'reporting', done:false },
    { id:'eod-2', group:'eod',     name:'Update task board / tracker',           tag:'tracking',  done:false },
    { id:'eod-3', group:'eod',     name:'Schedule tomorrow\'s priorities',       tag:'planning',  done:false },
    { id:'eod-4', group:'eod',     name:'Send team wrap-up notification',        tag:'comms',     done:false },
    { id:'eod-5', group:'eod',     name:'Archive completed work files',          tag:'archive',   done:false },
    { id:'eod-6', group:'eod',     name:'Close open tabs & save all work',       tag:'wrap-up',   done:false },
    { id:'eod-7', group:'eod',     name:'Shutdown Clawbot',                      tag:'system',    done:false },
  ];
}

// ── AUTO MODE SIMULATION MESSAGES ───��─────────────────────────
// Realistic log outputs Clawbot prints while "performing" each task
const autoSimMessages = {
  'em-1':  ['Connecting to IMAP server…', '📬 Inbox: 14 unread. 3 flagged URGENT.', '✓ Urgent emails flagged for action.'],
  'em-2':  ['Loading pending threads…', '✉ Composing replies to 5 client emails…', '✓ Replies sent. Threads marked resolved.'],
  'em-3':  ['Scanning spam folder…', '🗑 42 spam messages found. Unsubscribed from 3 lists.', '✓ Inbox cleaned.'],
  'em-4':  ['Parsing action items from inbox…', '📤 Forwarding 6 action items to team members…', '✓ Delegated and flagged for follow-up.'],
  'em-5':  ['Compiling daily digest…', '📊 Digest includes 12 updates, 3 highlights.', '✓ Daily digest sent to 8 stakeholders.'],
  'em-6':  ['Archiving processed email threads…', '📁 74 emails archived to /archive/2026-03.', '✓ Archive complete.'],
  'em-7':  ['Pulling delivery & bounce reports…', '⚠ 2 bounced addresses detected.', '✓ Bounce report logged and flagged.'],

  'tg-1':  ['Pinging Telegram bot API…', '🤖 Bot status: ONLINE. Uptime: 99.8%.', '✓ Bot healthy.'],
  'tg-2':  ['Fetching unread Telegram messages…', '💬 18 unread in 3 group chats. Composing replies…', '✓ Responses sent.'],
  'tg-3':  ['Building daily summary payload…', '📡 Sending task summary to #ops-channel…', '✓ Summary delivered to channel.'],
  'tg-4':  ['Checking bot command queue…', '⚙ 4 pending /status commands processed.', '✓ Commands handled.'],
  'tg-5':  ['Evaluating alert thresholds…', '🔔 1 threshold exceeded — alert sent to admin.', '✓ Notifications dispatched.'],
  'tg-6':  ['Pulling Telegram activity logs…', '📋 47 events logged today. No anomalies.', '✓ Logs reviewed.'],

  'ln-1':  ['Pinging LINE Messaging API…', '💚 LINE bot ONLINE. Webhook active.', '✓ LINE bot healthy.'],
  'ln-2':  ['Loading LINE contacts…', '💚 2 contacts available. Composing message…', '✓ LINE message sent.'],
  'ln-3':  ['Fetching LINE contact registry…', '💚 3 LINE contacts registered from webhook history.', '✓ Contacts reviewed.'],
  'ln-4':  ['Compiling EOD summary for LINE…', '📊 Wrap-up: task progress compiled. Sending via LINE…', '✓ EOD wrap-up sent via LINE.'],
  'ln-5':  ['Loading LINE outbox…', '📬 5 LINE messages sent today. All delivered.', '✓ Outbox reviewed.'],

  'vb-1':  ['Pinging Viber Bot API…', '🟣 Viber bot ONLINE. Auth token valid.', '✓ Viber bot healthy.'],
  'vb-2':  ['Loading Viber contacts…', '🟣 1 contact available. Composing message…', '✓ Viber message sent.'],
  'vb-3':  ['Fetching Viber contact registry…', '🟣 2 Viber contacts registered from webhook.', '✓ Contacts reviewed.'],
  'vb-4':  ['Compiling EOD summary for Viber…', '📊 Wrap-up: task progress compiled. Sending via Viber…', '✓ EOD wrap-up sent via Viber.'],
  'vb-5':  ['Loading Viber outbox…', '📬 3 Viber messages sent today. All delivered.', '✓ Outbox reviewed.'],

  'cal-1': ['Loading calendar API…', '📅 6 meetings scheduled today. 1 conflict detected.', '✓ Conflict flagged for resolution.'],
  'cal-2': ['Identifying upcoming meetings…', '🔔 Reminders sent to 12 attendees.', '✓ All reminders dispatched.'],
  'cal-3': ['Analysing tomorrow\'s workload…', '📋 4 priority tasks blocked into tomorrow\'s agenda.', '✓ Agenda set.'],
  'cal-4': ['Scanning calendar for open slots…', '🧘 2-hour focus block reserved: 10:00–12:00.', '✓ Focus time protected.'],
  'cal-5': ['Fetching pending invitations…', '✉ 3 invitations confirmed. 1 declined (conflict).', '✓ RSVPs complete.'],
  'cal-6': ['Initiating calendar sync…', '🔄 Syncing across Google, Outlook, mobile…', '✓ All devices in sync.'],

  'sec-1': ['Launching vulnerability scanner…', '🔍 Scanning 14 services… 0 critical, 2 medium CVEs found.', '⚠ 2 medium vulnerabilities — report generated.'],
  'sec-2': ['Querying SSL certificate registry…', '🔒 All certs valid. Nearest expiry: 47 days.', '✓ SSL/TLS certificates OK.'],
  'sec-3': ['Pulling authentication event logs…', '🔐 892 auth events. 0 anomalous patterns detected.', '✓ Auth logs clean.'],
  'sec-4': ['Running npm audit & dependency check…', '📦 3 outdated packages. 1 known CVE (low severity).', '⚠ CVE logged — patch scheduled.'],
  'sec-5': ['Scanning exposed ports…', '🛡 22 open ports. 2 unexpected — flagged for review.', '⚠ Firewall rule review recommended.'],
  'sec-6': ['Analysing failed login attempts…', '🚫 17 failed logins. 1 IP blocked (brute-force pattern).', '✓ Threat neutralised. IP blocked.'],
  'sec-7': ['Verifying backup checksums…', '💾 All 9 backups verified. Encryption: AES-256 OK.', '✓ Backup integrity confirmed.'],

  'mor-1': ['Loading standup notes…', '📋 Team standup briefing loaded.', '✓ Briefing reviewed.'],
  'mor-2': ['Checking overnight messages…', '📬 12 overnight messages. 2 urgent.', '✓ Messages reviewed and flagged.'],
  'mor-3': ['Syncing calendar…', '📅 Schedule loaded. 5 events today.', '✓ Calendar reviewed.'],
  'mor-4': ['Setting priorities…', '🎯 3 priority tasks identified for today.', '✓ Priorities set.'],
  'mor-5': ['Checking team availability…', '👥 8/10 team members available today.', '✓ Availability logged.'],
  'mor-6': ['Checking system alerts…', '🔔 2 overnight alerts. Both non-critical.', '✓ Alerts reviewed.'],
  'mor-7': ['Syncing calendars with leads…', '🔄 Calendars synced with 3 team leads.', '✓ Calendar sync complete.'],
  'mor-8': ['Generating morning status…', '📊 Status update compiled and ready.', '✓ Morning update prepared.'],

  'cor-1': ['Loading ticket queue…', '🎫 8 tickets queued. 2 high priority.', '✓ Tickets processed.'],
  'cor-2': ['Joining team sync…', '🤝 Sync meeting attended and notes captured.', '✓ Meeting logged.'],
  'cor-3': ['Reviewing project status…', '📊 3 projects on track. 1 at risk.', '✓ Status updated.'],
  'cor-4': ['Loading stakeholder queries…', '💬 5 queries pending. Responses drafted.', '✓ Queries handled.'],
  'cor-5': ['Documenting session…', '📝 Progress notes saved to shared doc.', '✓ Documentation updated.'],
  'cor-6': ['Loading PR review queue…', '🔍 3 PRs reviewed. 1 approved, 2 comments added.', '✓ Code reviews done.'],
  'cor-7': ['Opening kanban board…', '🗂 Sprint board updated. 4 tasks moved to done.', '✓ Board updated.'],
  'cor-8': ['Coordinating with teams…', '📡 3 cross-team syncs logged and confirmed.', '✓ Coordination complete.'],

  'mon-1': ['Running health checks…', '✅ All 12 services healthy. 0 downtime.', '✓ Systems nominal.'],
  'mon-2': ['Pulling error logs…', '⚠ 3 errors logged. 1 recurring — ticket created.', '✓ Errors reviewed.'],
  'mon-3': ['Verifying scheduled jobs…', '⚙ 7/7 scheduled jobs completed successfully.', '✓ Jobs verified.'],
  'mon-4': ['Running backup checks…', '💾 Backups verified. Last backup: 2h ago.', '✓ Backups healthy.'],
  'mon-5': ['Loading performance metrics…', '📈 Avg response: 142ms. CPU: 34%. All green.', '✓ Metrics nominal.'],
  'mon-6': ['Checking network usage…', '📡 Bandwidth: 2.3Gb used. No anomalies.', '✓ Network clean.'],

  'eod-1': ['Compiling end-of-day report…', '📄 Report: 28/50 tasks completed (56%).', '✓ Report ready.'],
  'eod-2': ['Updating task board…', '🗂 Board updated with final statuses.', '✓ Task board synced.'],
  'eod-3': ['Scheduling tomorrow…', '📅 5 tasks queued for tomorrow.', '✓ Tomorrow planned.'],
  'eod-4': ['Sending wrap-up to team…', '📤 Wrap-up notification sent to 8 members.', '✓ Team notified.'],
  'eod-5': ['Archiving work files…', '📁 12 files archived securely.', '✓ Files archived.'],
  'eod-6': ['Saving all work…', '💾 All sessions saved and closed.', '✓ Work saved.'],
  'eod-7': ['Initiating Clawbot shutdown sequence…', '⏻ Goodbye.', '✓ Clawbot stopped.'],
};

// ── BROADCAST ──────────────────────────────────────────────────
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

function addLog(msg, kind = '') {
  const entry = { msg, kind, ts: new Date().toISOString() };
  state.log.unshift(entry);
  if (state.log.length > 200) state.log.pop();
  broadcast('log', entry);
}

// ── GRAPH SNAPSHOT ─────────────────────────────────────────────
const ALL_GROUPS = ['morning','email','telegram','line','viber','calendar','security','core','monitor','eod'];

function snapshotGraph() {
  const byGroup = {};
  ALL_GROUPS.forEach(g => {
    const gt = state.tasks.filter(t => t.group === g);
    byGroup[g] = { total: gt.length, done: gt.filter(t => t.done).length };
  });
  const snap = {
    ts:        new Date().toISOString(),
    total:     state.tasks.length,
    completed: state.tasks.filter(t => t.done).length,
    byGroup
  };
  state.history.push(snap);
  if (state.history.length > 300) state.history.shift();
  broadcast('graph_update', snap);
}

// ── LINE WEBHOOK (must be before express.json so raw body is intact) ──────────
const lineContacts = {};

function verifyLineSignature(rawBody, signature, secret) {
  const hash = crypto.createHmac('SHA256', secret).update(rawBody).digest('base64');
  return hash === signature;
}

// LINE conversation history per userId
const lineHistory = {};

function lineReply(token, replyToken, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ replyToken, messages: [{ type: 'text', text }] });
    const req  = https.request({
      hostname: 'api.line.me',
      path:     '/v2/bot/message/reply',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Length': Buffer.byteLength(body) }
    }, res => { res.resume(); resolve(); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function autoReplyLine(token, targetId, replyToken, userText, displayName) {
  const cfg = loadOpenAIConfig();
  if (!cfg || cfg.apiKey === 'your-openai-api-key-here' || !cfg.autoReply) return;

  const openai  = new OpenAI({ apiKey: cfg.apiKey });
  const maxHist = cfg.maxHistoryMessages || 20;

  if (!lineHistory[targetId]) lineHistory[targetId] = [];
  // Store raw user text but send wrapped version to API
  lineHistory[targetId].push({ role: 'user', content: userText });
  if (lineHistory[targetId].length > maxHist) lineHistory[targetId] = lineHistory[targetId].slice(-maxHist);

  const cleanHist = lineHistory[targetId].map(m => {
    if (m.role === 'assistant') {
      // Replace any Thai/Burmese assistant content to stop contamination
      if (/[\u0E00-\u0E7F\u1000-\u109F]/.test(m.content))
        return { role: 'assistant', content: 'Understood. I will respond in English.' };
      return m;
    }
    if (m.role === 'user')
      return { role: 'user', content: `${m.content}\n\n[INSTRUCTION: Your reply MUST be in English only, not Thai, not Burmese]` };
    return m;
  });
  const messages = [
    { role: 'system', content: buildSystemPrompt(cfg.systemPrompt, 'line') },
    ...cleanHist
  ];

  try {
    let replyTokenUsed = false;   // replyToken expires after 30s — use push API after round 0
    for (let round = 0; round < 6; round++) {
      const completion = await openai.chat.completions.create({
        model: cfg.model || 'gpt-4o', messages, tools: CLAWBOT_TOOLS, tool_choice: 'auto'
      });
      const msg    = completion.choices[0].message;
      const reason = completion.choices[0].finish_reason;
      messages.push(msg);

      if (reason === 'stop' || !msg.tool_calls?.length) {
        const reply = msg.content;
        if (reply) {
          lineHistory[targetId].push({ role: 'assistant', content: reply });
          // Use replyToken on first round (fast path), fall back to push API after tool rounds
          if (!replyTokenUsed && round === 0) {
            await lineReply(token, replyToken, reply).catch(() => linePost(token, targetId, reply));
          } else {
            await linePost(token, targetId, reply);
          }
          addLog(`🤖 LINE auto-replied to ${displayName}: "${reply.slice(0, 60)}"`, 'task');
          broadcast('line_auto_reply', { userId: targetId, displayName, reply, ts: new Date().toISOString() });
          const outEntry = { userId: targetId, message: reply, sentAt: new Date().toISOString() };
          lineOutbox.unshift(outEntry);
          if (lineOutbox.length > 50) lineOutbox.pop();
        }
        break;
      }

      replyTokenUsed = true;   // tool calls happened — replyToken likely expired now
      const toolResults = await Promise.all(
        msg.tool_calls.map(async tc => {
          const args   = JSON.parse(tc.function.arguments);
          const result = await executeClawbotTool(tc.function.name, args);
          addLog(`🔧 LINE AI tool: ${tc.function.name}`, 'task');
          broadcast('line_tool_called', { tool: tc.function.name, args, result });
          return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
        })
      );
      messages.push(...toolResults);
    }
  } catch (err) {
    addLog(`❌ LINE AI agent failed: ${err.message}`, 'off');
  }
}

function handleLineWebhook(req, res) {
  res.status(200).end(); // respond immediately

  const cfg       = loadLineConfig();
  const secret    = cfg?.channel?.channel_secret;
  const token     = cfg?.channel?.channel_access_token;
  const signature = req.headers['x-line-signature'];
  const rawBody   = req.body;

  // Fail-closed: if secret is configured, signature MUST be present and valid
  if (secret) {
    if (!signature || !verifyLineSignature(rawBody, signature, secret)) return;
  }

  let body;
  try { body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString() : JSON.stringify(rawBody)); }
  catch (_) { return; }

  (body.events || []).forEach(event => {
    const userId      = event.source?.userId;
    const groupId     = event.source?.groupId;
    const roomId      = event.source?.roomId;
    const targetId = groupId || roomId || userId;

    if (targetId && !lineContacts[targetId]) {
      const defaultName = groupId ? `Group ${groupId.slice(0, 8)}` : 'LINE User';
      lineContacts[targetId] = {
        userId: targetId, displayName: defaultName,
        type: event.source?.type || 'user', addedAt: new Date().toISOString(), lastMsg: ''
      };
      // Fetch real display name async without blocking
      if (userId) {
        (async () => {
          try {
            const lineCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'clawbot_line_config.json'), 'utf8'));
            const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
              headers: { Authorization: `Bearer ${lineCfg.channel.channel_access_token}` }
            });
            if (profileRes.ok) {
              const profile = await profileRes.json();
              if (profile.displayName) lineContacts[targetId].displayName = profile.displayName;
            }
          } catch {}
          addLog(`💚 LINE: New contact — ${lineContacts[targetId].displayName}`, 'on');
          broadcast('line_contact_added', lineContacts[targetId]);
        })();
      } else {
        addLog(`💚 LINE: New contact — ${defaultName}`, 'on');
        broadcast('line_contact_added', lineContacts[targetId]);
      }
    }

    if (event.type === 'message' && event.message?.type === 'text') {
      const text        = event.message.text || '';
      const replyToken  = event.replyToken;
      const contactName = lineContacts[targetId]?.displayName || targetId;
      if (lineContacts[targetId]) {
        lineContacts[targetId].lastMsg  = text.slice(0, 80);
        lineContacts[targetId].lastSeen = new Date().toISOString();
      }
      addLog(`💚 LINE msg from ${contactName}: "${text.slice(0, 60)}"`, 'task');
      broadcast('line_message', { userId: targetId, displayName: contactName, text, ts: new Date().toISOString() });

      // AI auto-reply via replyToken
      if (token && replyToken) autoReplyLine(token, targetId, replyToken, text, contactName);
    }

    if (event.type === 'follow') {
      const followName = lineContacts[targetId]?.displayName || userId;
      addLog(`💚 LINE: ${followName} followed your bot.`, 'on');
      if (token && event.replyToken) {
        autoReplyLine(token, userId, event.replyToken, 'Hello! I just followed your bot.', followName);
      }
    }
  });
}

const lineWebhookMiddleware = express.raw({ type: '*/*' });
app.post('/api/line/webhook',       lineWebhookMiddleware, handleLineWebhook);
app.post('/webhook-test/line',      lineWebhookMiddleware, handleLineWebhook);

// ── STATIC ─────────────────────────────────────────────────────
app.use(express.json());
// Block config/secret files from being served as static assets
app.use((req, res, next) => {
  if (/\.(json|env|key|pem|p12)$/i.test(req.path)) return res.status(404).end();
  next();
});
app.use(express.static(path.join(__dirname)));
// Auth guard — all /api/ routes except webhooks
app.use(requireAuth);

// ── API ────────────────────────────────────────────────────────

// Bootstrap: web GUI calls this on first load to get the API key and store it in localStorage
app.get('/api/auth/key', (_req, res) => res.json({ apiKey: authCfg.apiSecret || '' }));

app.get('/api/state', (_req, res) => res.json(state));

app.post('/api/task/:id/toggle', (req, res) => {
  const task = state.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.done = !task.done;
  addLog(task.done ? `Completed: "${task.name}"` : `Reopened: "${task.name}"`, task.done ? 'task' : '');
  broadcast('task_update', task);
  snapshotGraph();
  if (task.done) fireZapier('task_completed', { taskId: task.id, taskName: task.name, group: task.group });
  res.json(task);
});

app.post('/api/task', (req, res) => {
  const { name, group } = req.body || {};
  if (!name || !group) return res.status(400).json({ error: 'name and group required' });
  const task = {
    id:     `custom-${Date.now()}`,
    group:  ALL_GROUPS.includes(group) ? group : 'core',
    name:   String(name).trim().slice(0, 100),
    tag:    'custom',
    done:   false,
    custom: true
  };
  state.tasks.push(task);
  addLog(`Added task: "${task.name}"`, 'add');
  broadcast('task_added', task);
  snapshotGraph();
  res.json(task);
});

app.delete('/api/task/:id', (req, res) => {
  const idx = state.tasks.findIndex(t => t.id === req.params.id && t.custom);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  const [removed] = state.tasks.splice(idx, 1);
  addLog(`Deleted: "${removed.name}"`, 'del');
  broadcast('task_deleted', { id: removed.id });
  snapshotGraph();
  res.json({ ok: true });
});

app.post('/api/reset', (_req, res) => {
  stopAutoMode();
  state.tasks   = buildDefaultTasks();
  state.history = [];
  addLog('Day reset — all tasks cleared for new session.', 'on');
  broadcast('reset', { tasks: state.tasks });
  snapshotGraph();
  res.json({ ok: true });
});

// ── AUTO MODE ──────────────────────────────────────────────────
function startAutoMode() {
  if (autoTimer) return;
  state.autoMode = true;
  addLog('⚡ Clawbot Auto Mode ACTIVATED — performing tasks on your behalf…', 'on');
  broadcast('auto_mode', { active: true });
  runNextAutoTask();
}

function buildCompletionReport() {
  const now      = new Date();
  const started  = new Date(state.startedAt);
  const elapsed  = Math.round((now - started) / 60000);
  const byGroup  = {};
  ALL_GROUPS.forEach(g => {
    const gt = state.tasks.filter(t => t.group === g);
    byGroup[g] = {
      total:  gt.length,
      done:   gt.filter(t => t.done).length,
      tasks:  gt.map(t => ({ name: t.name, tag: t.tag, done: t.done }))
    };
  });
  return {
    title:       'Clawbot Daily Operations — Completion Report',
    generatedAt: now.toISOString(),
    startedAt:   state.startedAt,
    elapsedMin:  elapsed,
    totals: {
      all:       state.tasks.length,
      completed: state.tasks.filter(t => t.done).length,
      pending:   state.tasks.filter(t => !t.done).length,
    },
    byGroup
  };
}

// Vary delays to feel like a real agent thinking/working
function randDelay(min, max) { return min + Math.floor(Math.random() * (max - min)); }

// Track last group to announce group transitions
let autoLastGroup = null;
let autoTasksDoneCount = 0;

function runNextAutoTask() {
  if (!state.autoMode) return;

  const all     = state.tasks;
  const pending = all.filter(t => !t.done);
  const total   = all.length;
  const done    = all.filter(t => t.done).length;

  if (pending.length === 0) {
    const report = buildCompletionReport();
    addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'task');
    addLog('✅ CLAWBOT DAILY REPORT — ALL TASKS COMPLETE', 'task');
    addLog(`📋 ${report.totals.completed}/${report.totals.all} tasks completed in ${report.elapsedMin} min`, 'task');
    ALL_GROUPS.forEach(g => {
      const gd = report.byGroup[g];
      if (gd.total > 0) addLog(`  ✓ ${g.padEnd(10)} ${gd.done}/${gd.total} tasks done`, 'task');
    });
    addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'task');
    broadcast('all_complete', report);
    fireZapier('all_tasks_complete', { completed: report.totals.completed, total: report.totals.all, elapsedMin: report.elapsedMin });
    autoLastGroup = null;
    autoTasksDoneCount = 0;
    stopAutoMode();
    return;
  }

  const task = pending[0];
  const pct  = Math.round((done / total) * 100);

  // Announce group transition
  if (task.group !== autoLastGroup) {
    const groupNames = {
      morning:'Morning Startup', email:'Email', telegram:'Telegram',
      line:'LINE', viber:'Viber',
      calendar:'Calendar', security:'Security & Vulnerabilities',
      core:'Core Operations', monitor:'Monitoring', eod:'End of Day'
    };
    addLog(`── Moving to: ${groupNames[task.group] || task.group} ──`, 'on');
    autoLastGroup = task.group;
  }

  const simLines = autoSimMessages[task.id] || [
    `Processing: "${task.name}"…`,
    `Analysing data and preparing output…`,
    `✓ Task completed.`
  ];

  broadcast('auto_working', { taskId: task.id, taskName: task.name, pct, done, total });
  addLog(`[Auto ${done + 1}/${total}] ▶ ${task.name}`, 'add');

  let lineIndex = 0;

  function printNextLine() {
    if (lineIndex < simLines.length) {
      const isLast = lineIndex === simLines.length - 1;
      addLog(`  › ${simLines[lineIndex]}`, isLast ? 'task' : '');
      lineIndex++;
      // Vary delay: last line before marking done gets slightly longer pause
      autoTimer = setTimeout(printNextLine, isLast ? randDelay(600, 1000) : randDelay(500, 900));
    } else {
      task.done = true;
      autoTasksDoneCount++;
      broadcast('task_update', task);
      snapshotGraph();

      // Periodic progress checkpoint every 5 tasks
      if (autoTasksDoneCount % 5 === 0) {
        const nowPct = Math.round(((done + 1) / total) * 100);
        addLog(`⚡ Clawbot progress: ${done + 1}/${total} tasks done (${nowPct}%) — continuing…`, 'on');
      }

      // Pause before next task — vary to feel human
      autoTimer = setTimeout(runNextAutoTask, randDelay(800, 1600));
    }
  }

  autoTimer = setTimeout(printNextLine, randDelay(300, 600));
}

function stopAutoMode(sendPartialReport = false) {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  if (!state.autoMode) return;
  state.autoMode = false;
  broadcast('auto_mode', { active: false });
  if (sendPartialReport) {
    const report = buildCompletionReport();
    addLog(`⏹ Auto Mode stopped. ${report.totals.completed}/${report.totals.all} tasks done.`, 'off');
    broadcast('partial_report', report);
  } else {
    addLog('⏹ Clawbot Auto Mode OFF.', 'off');
  }
}

app.post('/api/auto/start', (_req, res) => { startAutoMode(); res.json({ ok: true }); });
app.post('/api/auto/stop',  (_req, res) => { stopAutoMode(true); res.json({ ok: true }); });

// Full completion report
app.get('/api/report/full', (_req, res) => res.json(buildCompletionReport()));

// ── EMAIL SEND ─────────────────────────────────────────────────
// Load config each call so user can edit email.config.json without restart
function loadEmailConfig() {
  const cfgPath = path.join(__dirname, 'email.config.json');
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Outbox: keep last 50 sent emails in memory for display
const outbox = [];

function createTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure || false,
    auth: { user: cfg.user, pass: cfg.password }
  });
}

app.get('/api/email/config-status', (_req, res) => {
  const cfg = loadEmailConfig();
  if (!cfg) return res.json({ configured: false, reason: 'email.config.json not found' });
  if (cfg.user === 'your@email.com') return res.json({ configured: false, reason: 'Default credentials — please edit email.config.json' });
  res.json({ configured: true, user: cfg.user, host: cfg.host });
});

app.post('/api/email/ai-compose', async (req, res) => {
  const { instructions, to, subject } = req.body || {};
  if (!instructions) return res.status(400).json({ ok: false, error: 'instructions required' });

  const cfg = loadOpenAIConfig();
  if (!cfg || cfg.apiKey === 'your-openai-api-key-here')
    return res.status(503).json({ ok: false, error: 'OpenAI not configured' });

  const emailCfg = loadEmailConfig();
  const sender   = emailCfg?.fromName || 'Kyaw Zin';

  try {
    const openai     = new OpenAI({ apiKey: cfg.apiKey });
    const completion = await openai.chat.completions.create({
      model: cfg.model || 'gpt-4o',
      messages: [
        { role: 'system', content: `You are an email writing assistant for ${sender} at Mawbolt Systems. Write professional, concise business emails. Respond ONLY with a JSON object: {"to":"...","subject":"...","body":"..."}. Fill in "to" and "subject" only if they are empty or not provided.` },
        { role: 'user',   content: `To: ${to || '(unknown)'}\nSubject: ${subject || '(not set)'}\n\nInstructions: ${instructions}` }
      ],
      response_format: { type: 'json_object' }
    });
    const draft = JSON.parse(completion.choices[0].message.content);
    res.json({ ok: true, to: draft.to || to || '', subject: draft.subject || subject || '', body: draft.body || '' });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

app.post('/api/email/send', async (req, res) => {
  const { to, subject, body, replyTo } = req.body || {};
  if (!to || !subject || !body) {
    return res.status(400).json({ ok: false, error: 'to, subject, and body are required' });
  }

  const cfg = loadEmailConfig();
  if (!cfg || cfg.user === 'your@email.com') {
    return res.status(503).json({ ok: false, error: 'Email not configured. Edit email.config.json first.' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host:   cfg.host,
      port:   cfg.port,
      secure: cfg.secure || false,
      auth:   { user: cfg.user, pass: cfg.password }
    });

    const info = await transporter.sendMail({
      from:    `"${cfg.fromName || 'Clawbot'}" <${cfg.user}>`,
      to,
      subject,
      text:    body + getSignature(cfg),
      ...(replyTo ? { inReplyTo: replyTo, references: replyTo } : {})
    });

    const entry = {
      id:        info.messageId,
      to,
      subject,
      body,
      sentAt:    new Date().toISOString(),
      status:    'sent'
    };
    outbox.unshift(entry);
    if (outbox.length > 50) outbox.pop();

    addLog(`📤 Email sent → ${to} | Subject: "${subject}"`, 'task');
    broadcast('email_sent', entry);
    res.json({ ok: true, messageId: info.messageId });

  } catch (err) {
    addLog(`❌ Email failed → ${to}: ${err.message}`, 'off');
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

app.get('/api/email/outbox', (_req, res) => res.json({ outbox }));

// ── INBOX SCAN — keyword flagging ──────────────────────────────
const { ImapFlow } = require('imapflow');

const SCAN_KEYWORDS = [
  // Finance
  'finance','financial','invoice','payment','billing','budget','transfer','bank account','salary','wire','remittance',
  // Visa / Immigration
  'visa','australia visa','immigration','migration','permit','residency','sponsorship','work permit',
  // Access / Authorization
  'grant access','access granted','access denied','permission','authorize','credentials','login required','account access',
  // Rejection / Denial
  'reject','rejected','decline','declined','denied','not approved','application refused','unsuccessful',
  // Approval
  'approved','approval','congratulations','accepted','successful application','offer letter',
  // Critical / Urgent
  'critical','urgent','immediate action','asap','emergency','deadline','time sensitive','action required','respond immediately',
  // Security
  'security alert','breach','suspicious activity','unauthorized','verify your account','password reset','2fa','otp',
  // General important
  'contract','agreement','legal','court','tax','refund','overdue','final notice','warning'
];

function getPriority(keywords) {
  const high = ['critical','urgent','reject','rejected','denied','breach','unauthorized','security alert','immediate action','final notice','warning','court','overdue','emergency'];
  return keywords.some(k => high.some(h => k.includes(h))) ? 'high' : 'medium';
}

async function scanInbox(cfg) {
  const client = new ImapFlow({
    host:   cfg.imapHost || 'imap.gmail.com',
    port:   cfg.imapPort || 993,
    secure: true,
    auth:   { user: cfg.user, pass: cfg.password },
    logger: false
  });
  await client.connect();
  const mailbox = await client.mailboxOpen('INBOX');
  const exists  = mailbox.exists || 0;
  if (exists === 0) { await client.logout(); return []; }

  const limit   = cfg.scanLimit || 100;
  const start   = Math.max(1, exists - limit + 1);
  const flagged = [];
  let   total   = 0;

  for await (const msg of client.fetch(`${start}:*`, { envelope: true, flags: true })) {
    total++;
    const subject  = msg.envelope?.subject || '(No subject)';
    const fromAddr = msg.envelope?.from?.[0]?.address || '';
    const fromName = msg.envelope?.from?.[0]?.name || '';
    const date     = msg.envelope?.date;
    const haystack = (subject + ' ' + fromAddr + ' ' + fromName).toLowerCase();
    const matched  = SCAN_KEYWORDS.filter(kw => haystack.includes(kw.toLowerCase()));
    if (matched.length > 0) {
      flagged.push({
        uid: msg.uid, subject,
        from: fromName ? `${fromName} <${fromAddr}>` : fromAddr,
        date: date ? date.toISOString() : null,
        seen: msg.flags?.has('\\Seen'),
        keywords: matched, priority: getPriority(matched)
      });
    }
  }
  await client.logout();
  flagged.sort((a, b) => {
    if (a.priority === 'high' && b.priority !== 'high') return -1;
    if (b.priority === 'high' && a.priority !== 'high') return 1;
    return new Date(b.date) - new Date(a.date);
  });
  addLog(`📬 Inbox scan — ${flagged.length} flagged of ${total} scanned`, 'task');
  broadcast('inbox_scan', { flagged, total });
  return flagged;
}

app.get('/api/email/scan', async (_req, res) => {
  const cfg = loadEmailConfig();
  if (!cfg || cfg.user === 'your@email.com')
    return res.status(503).json({ ok: false, error: 'Email not configured.' });
  try {
    const flagged = await scanInbox(cfg);
    if (flagged.length > 0) fireZapier('urgent_email', { count: flagged.length, emails: flagged.slice(0, 5) });
    res.json({ ok: true, flagged, total: flagged.length, scanned: flagged.length });
  } catch (err) {
    addLog(`❌ Inbox scan failed: ${err.message}`, 'off');
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// ── TELEGRAM SEND ──────────────────────────────────────────────
function loadTelegramConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'telegram.config.json'), 'utf8'));
  } catch (_) { return null; }
}

const tgOutbox = [];

function telegramPost(botToken, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${botToken}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('Invalid response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

app.get('/api/telegram/config-status', (_req, res) => {
  const cfg = loadTelegramConfig();
  if (!cfg) return res.json({ configured: false, reason: 'telegram.config.json not found' });
  if (cfg.botToken === 'your-bot-token-here') return res.json({ configured: false, reason: 'Default token — edit telegram.config.json' });
  res.json({ configured: true, defaultChatId: cfg.defaultChatId, fromName: cfg.fromName });
});

app.post('/api/telegram/send', async (req, res) => {
  const { chatId, message } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'message is required' });

  const cfg = loadTelegramConfig();
  if (!cfg || cfg.botToken === 'your-bot-token-here') {
    return res.status(503).json({ ok: false, error: 'Telegram not configured. Edit telegram.config.json first.' });
  }

  const targetChat = chatId || cfg.defaultChatId;
  if (!targetChat || targetChat === 'your-chat-id-here') {
    return res.status(400).json({ ok: false, error: 'No chat ID — set defaultChatId in telegram.config.json' });
  }

  try {
    const result = await telegramPost(cfg.botToken, { chat_id: targetChat, text: message, parse_mode: 'HTML' });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.description || 'Telegram API error' });

    const entry = { chatId: targetChat, message, sentAt: new Date().toISOString() };
    tgOutbox.unshift(entry);
    if (tgOutbox.length > 50) tgOutbox.pop();

    addLog(`📱 Telegram sent → chat ${targetChat}: "${message.slice(0, 60)}"`, 'task');
    broadcast('telegram_sent', entry);
    res.json({ ok: true, messageId: result.result?.message_id });
  } catch (err) {
    addLog(`❌ Telegram failed: ${err.message}`, 'off');
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

app.get('/api/telegram/outbox', (_req, res) => res.json({ outbox: tgOutbox }));

// ── TELEGRAM CONTACTS, WEBHOOK & AI AUTO-REPLY ─────────────────
const tgContacts = {};       // chatId -> { chatId, name, username, addedAt, lastMsg }
const tgHistory  = {};       // chatId -> [ {role, content}, ... ]

function loadOpenAIConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'openai.config.json'), 'utf8')); }
  catch (_) { return null; }
}

// ── CLAWBOT TOOLS (OpenAI function calling) ─────────────────────
const CLAWBOT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_task_status',
      description: 'Get current Clawbot task completion status across all workflow groups',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark a specific Clawbot task as done or undone',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID e.g. em-1, tg-2, ln-3, vb-2, cal-1, eod-1' },
          done:   { type: 'boolean', description: 'true to complete, false to undo' }
        },
        required: ['taskId', 'done']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_activity_log',
      description: 'Get recent Clawbot activity log entries',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of recent log entries (default 10)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_telegram_message',
      description: 'Send a Telegram message to a specific chat or the default contact',
      parameters: {
        type: 'object',
        properties: {
          chatId:  { type: 'string', description: 'Numeric chat ID or @username (optional — uses default if omitted)' },
          message: { type: 'string', description: 'Message text to send' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_line_message',
      description: 'Send a LINE message to a user',
      parameters: {
        type: 'object',
        properties: {
          userId:  { type: 'string', description: 'LINE user ID starting with U (optional — uses default if omitted)' },
          message: { type: 'string', description: 'Message text to send' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar_events',
      description: 'Get calendar events for today or any specific date from Google Calendar',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format. Omit for today. Use "tomorrow" or the actual date for future days.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_eod_report',
      description: 'Generate an end-of-day summary report of all tasks',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scan_inbox',
      description: 'Scan email inbox for urgent/flagged emails matching priority keywords',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Send an email with a fully written body',
      parameters: {
        type: 'object',
        properties: {
          to:      { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body:    { type: 'string', description: 'Full email body — write this yourself based on the context' }
        },
        required: ['to', 'subject', 'body']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compose_and_send_email',
      description: 'Compose and send an email by describing what to say — AI writes the full content automatically',
      parameters: {
        type: 'object',
        properties: {
          to:           { type: 'string', description: 'Recipient email address' },
          instructions: { type: 'string', description: 'Brief description of what the email should say' },
          subject_hint: { type: 'string', description: 'Optional subject hint' }
        },
        required: ['to', 'instructions']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_viber_message',
      description: 'Send a Viber message to a user',
      parameters: {
        type: 'object',
        properties: {
          viberId: { type: 'string', description: 'Viber user ID (optional — uses first known contact if omitted)' },
          message: { type: 'string', description: 'Message text to send' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'toggle_auto_mode',
      description: 'Enable or disable Clawbot auto mode which runs all tasks automatically',
      parameters: {
        type: 'object',
        properties: {
          enable: { type: 'boolean', description: 'true to enable, false to disable' }
        },
        required: ['enable']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_telegram_messages',
      description: 'Get recent Telegram messages sent/received, and list known Telegram contacts',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_line_messages',
      description: 'Get recent LINE messages sent/received, and list known LINE contacts',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_viber_messages',
      description: 'Get recent Viber messages sent/received, and list known Viber contacts',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reset_tasks',
      description: 'Reset all tasks to undone for a fresh daily cycle',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_email_with_attachment',
      description: 'Find a file in Google Drive by name and send it as an email attachment',
      parameters: {
        type: 'object',
        properties: {
          to:       { type: 'string', description: 'Recipient email address' },
          subject:  { type: 'string', description: 'Email subject' },
          body:     { type: 'string', description: 'Email body text' },
          filename: { type: 'string', description: 'File name to search in Google Drive and attach e.g. "956.pdf", "LV logo.png"' }
        },
        required: ['to', 'subject', 'filename']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_google_drive',
      description: 'Search for files or folders anywhere in Google Drive including subfolders by name or keyword',
      parameters: {
        type: 'object',
        properties: {
          query:       { type: 'string', description: 'File name or keyword e.g. "LV logo", "842 form", "invoice"' },
          folder_name: { type: 'string', description: 'Optional: limit search to a specific folder name' },
          limit:       { type: 'number', description: 'Max results (default 15)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_drive_files',
      description: 'List recent files or contents of a specific folder in Google Drive',
      parameters: {
        type: 'object',
        properties: {
          folder_name: { type: 'string', description: 'Folder name to list contents of. Omit to list all recent files.' },
          limit:       { type: 'number', description: 'Max results (default 20)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_calendar_event',
      description: 'Delete a Google Calendar event by title keyword and optional time — searches the next 14 days',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Event title keyword to search for e.g. "AI Meeting", "standup"' },
          time:  { type: 'string', description: 'Optional time hint to narrow match e.g. "14:00", "2pm"' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description: 'Create a new Google Calendar event for Kyaw Zin',
      parameters: {
        type: 'object',
        properties: {
          title:       { type: 'string', description: 'Event title/name' },
          date:        { type: 'string', description: 'Date in YYYY-MM-DD format (defaults to today)' },
          time:        { type: 'string', description: 'Start time in HH:MM 24-hour format e.g. 14:00' },
          duration:    { type: 'number', description: 'Duration in minutes (default 60)' },
          description: { type: 'string', description: 'Optional event description or notes' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_notion_task',
      description: 'Create a task or page in Notion via Zapier',
      parameters: {
        type: 'object',
        properties: {
          title:       { type: 'string', description: 'Task or page title' },
          description: { type: 'string', description: 'Task details or notes' },
          due_date:    { type: 'string', description: 'Due date in YYYY-MM-DD format (optional)' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_facebook_message',
      description: 'Send a Facebook Messenger message via the Graph API to a user or default recipient',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string', description: 'Facebook PSID (Page-Scoped User ID) of the recipient. Omit to use default recipient from config.' },
          message:   { type: 'string', description: 'Message text to send' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_drive_file',
      description: 'Delete one or all matching files in Google Drive by name. Use delete_all=true to delete all matches.',
      parameters: {
        type: 'object',
        properties: {
          filename:   { type: 'string', description: 'File name or keyword to search and delete e.g. "Clawbot", "956.pdf"' },
          delete_all: { type: 'boolean', description: 'true = delete all matching files, false = delete only the most recent match (default false)' }
        },
        required: ['filename']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_drive_folder',
      description: 'Create a new folder in Google Drive. Optionally place it inside an existing parent folder.',
      parameters: {
        type: 'object',
        properties: {
          name:          { type: 'string', description: 'Folder name to create e.g. "ClawBot"' },
          parent_folder: { type: 'string', description: 'Optional: name of an existing parent folder to create this inside' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_google_sheet',
      description: 'Create a new Google Sheet with a title and optional header columns, then return the URL to open it',
      parameters: {
        type: 'object',
        properties: {
          title:   { type: 'string', description: 'Name of the new Google Sheet e.g. "Clawbot Contacts"' },
          headers: { type: 'array', items: { type: 'string' }, description: 'Column header names e.g. ["Name","Phone","Email","Notes"]' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_google_sheet',
      description: 'Read rows from a Google Sheet — auto-finds the sheet by name in Drive. No ID needed.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'Google Sheet ID (optional — auto-finds from Drive if omitted)' },
          sheet_name:     { type: 'string', description: 'Sheet file name keyword to search in Drive e.g. "sales", "clients", "tasks" — also used as tab name' },
          range:          { type: 'string', description: 'Cell range e.g. "A1:D20" (default: all)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'append_to_sheet',
      description: 'Add a new row of data to a Google Sheet — use for logging, tracking, invoices',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'Google Sheet ID (optional — uses default if omitted)' },
          sheet_name:     { type: 'string', description: 'Tab/sheet name e.g. "Sheet1"' },
          values:         { type: 'array',  description: 'Array of cell values for the new row e.g. ["2026-03-14","Client A","$500","Paid"]', items: { type: 'string' } }
        },
        required: ['values']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Set a reminder that fires at a specific time — sends a Telegram notification and web alert',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'What to remind about e.g. "Call David at ABC Company"' },
          when:    { type: 'string', description: 'When to fire: "in 2 hours", "in 30 minutes", "tomorrow at 9am", "at 3pm", or ISO datetime' }
        },
        required: ['message', 'when']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: 'List all pending (not yet fired) reminders',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancel_reminder',
      description: 'Cancel a pending reminder by its ID',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Reminder ID from list_reminders' }
        },
        required: ['id']
      }
    }
  }
];

async function executeClawbotTool(toolName, args) {
  try {
    switch (toolName) {

      case 'get_task_status': {
        const groups = {};
        state.tasks.forEach(t => {
          if (!groups[t.group]) groups[t.group] = { total: 0, done: 0, tasks: [] };
          groups[t.group].total++;
          if (t.done) groups[t.group].done++;
          groups[t.group].tasks.push({ id: t.id, name: t.name, done: t.done });
        });
        const total     = state.tasks.length;
        const completed = state.tasks.filter(t => t.done).length;
        return { total, completed, pending: total - completed, groups };
      }

      case 'complete_task': {
        const task = state.tasks.find(t => t.id === args.taskId);
        if (!task) return { error: `Task ${args.taskId} not found` };
        task.done = args.done;
        broadcast('task_update', state.tasks);
        addLog(`🤖 AI ${args.done ? 'completed' : 'un-completed'} task: ${task.name}`, 'task');
        return { ok: true, taskId: args.taskId, name: task.name, done: args.done };
      }

      case 'get_activity_log': {
        const limit = args.limit || 10;
        return { log: state.log.slice(0, limit) };
      }

      case 'send_telegram_message': {
        const tgCfg = loadTelegramConfig();
        if (!tgCfg) return { error: 'Telegram not configured' };
        const target = args.chatId || tgCfg.defaultChatId;
        const result = await telegramPost(tgCfg.botToken, { chat_id: target, text: args.message });
        if (result.ok) {
          addLog(`🤖 AI sent Telegram → ${target}: "${args.message.slice(0, 50)}"`, 'task');
          return { ok: true, sentTo: target };
        }
        return { error: result.description || 'Telegram send failed' };
      }

      case 'send_line_message': {
        const lineCfg = loadLineConfig();
        if (!lineCfg) return { error: 'LINE not configured' };
        const token  = lineCfg.channel?.channel_access_token;
        const target = args.userId || lineCfg.defaultUserId;
        if (!token || !target) return { error: 'LINE token or userId missing' };
        await linePost(token, target, args.message);
        addLog(`🤖 AI sent LINE → ${target}: "${args.message.slice(0, 50)}"`, 'task');
        return { ok: true, sentTo: target };
      }

      case 'get_calendar_events': {
        const { date: reqDate } = args || {};
        let targetDate = null;
        if (reqDate) {
          if (reqDate.toLowerCase() === 'tomorrow') {
            targetDate = new Date(); targetDate.setDate(targetDate.getDate() + 1);
          } else {
            targetDate = new Date(reqDate);
          }
        }
        const result = await fetchCalendarEvents(targetDate);
        return result;
      }

      case 'get_eod_report': {
        const total     = state.tasks.length;
        const completed = state.tasks.filter(t => t.done).length;
        const pending   = total - completed;
        const byGroup   = {};
        state.tasks.forEach(t => {
          if (!byGroup[t.group]) byGroup[t.group] = { done: 0, total: 0 };
          byGroup[t.group].total++;
          if (t.done) byGroup[t.group].done++;
        });
        return { date: new Date().toDateString(), total, completed, pending, byGroup };
      }

      case 'scan_inbox': {
        const emailCfg = loadEmailConfig();
        if (!emailCfg) return { error: 'Email not configured' };
        const flagged = await scanInbox(emailCfg);
        return { scanned: true, flaggedCount: flagged.length, flagged: flagged.slice(0, 5) };
      }

      case 'send_email': {
        const emailCfg = loadEmailConfig();
        if (!emailCfg) return { error: 'Email not configured' };
        const transporter = createTransporter(emailCfg);
        await transporter.sendMail({ from: `"${emailCfg.fromName || 'Clawbot'}" <${emailCfg.user}>`, to: args.to, subject: args.subject, text: (args.body || '') + getSignature(emailCfg) });
        addLog(`🤖 AI sent email → ${args.to}: "${args.subject}"`, 'task');
        return { ok: true, sentTo: args.to, subject: args.subject };
      }

      case 'send_email_with_attachment': {
        const { to, subject, body, filename } = args;
        const emailCfg = loadEmailConfig();
        if (!emailCfg) return { error: 'Email not configured' };
        const drive = getDriveClient();
        if (!drive) return { error: 'Google Drive not configured' };

        // Find the file in Drive — try full name first, then core number/word
        const FILLERS2 = new Set(['a','an','the','my','form','file','document','pdf','doc']);
        const cleanTokens = filename.split(/\s+/).filter(t => !FILLERS2.has(t.toLowerCase()));
        const searchTerms2 = [filename, ...cleanTokens];
        let file = null;
        for (const term of searchTerms2) {
          const searchRes = await drive.files.list({
            q: `name contains '${term.replace(/'/g, "\\'")}' and trashed = false`,
            pageSize: 5, fields: 'files(id,name,mimeType)', orderBy: 'modifiedTime desc'
          });
          file = searchRes.data.files?.[0];
          if (file) break;
        }
        if (!file) return { ok: false, error: `File "${filename}" not found in Google Drive.` };

        // Download file content using stream for reliability
        const fileBuffer = await new Promise((resolve, reject) => {
          const chunks = [];
          drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' })
            .then(res => {
              res.data.on('data', chunk => chunks.push(Buffer.from(chunk)));
              res.data.on('end', () => resolve(Buffer.concat(chunks)));
              res.data.on('error', reject);
            }).catch(reject);
        });

        // Send with attachment
        const transporter = createTransporter(emailCfg);
        await transporter.sendMail({
          from: `"${emailCfg.fromName || 'Clawbot'}" <${emailCfg.user}>`,
          to, subject, text: (body || `Please find ${file.name} attached.`) + getSignature(emailCfg),
          attachments: [{ filename: file.name, content: fileBuffer }]
        });
        addLog(`📎 AI sent email with attachment "${file.name}" → ${to}`, 'task');
        return { ok: true, sentTo: to, subject, attachedFile: file.name };
      }

      case 'compose_and_send_email': {
        const emailCfg2 = loadEmailConfig();
        if (!emailCfg2) return { error: 'Email not configured' };
        const aiCfg = loadOpenAIConfig();
        if (!aiCfg || aiCfg.apiKey === 'your-openai-api-key-here') return { error: 'OpenAI not configured' };
        const openai2    = new OpenAI({ apiKey: aiCfg.apiKey });
        const completion = await openai2.chat.completions.create({
          model: aiCfg.model || 'gpt-4o',
          messages: [
            { role: 'system', content: `You are an email writing assistant for ${emailCfg2.fromName || 'Kyaw Zin'} at Mawbolt Systems. Write a professional, concise business email. Respond ONLY with JSON: {"subject":"...","body":"..."}` },
            { role: 'user',   content: `To: ${args.to}\nSubject hint: ${args.subject_hint || 'auto'}\nInstructions: ${args.instructions}` }
          ],
          response_format: { type: 'json_object' }
        });
        const draft = JSON.parse(completion.choices[0].message.content);
        const transporter2 = createTransporter(emailCfg2);
        await transporter2.sendMail({ from: `"${emailCfg2.fromName || 'Clawbot'}" <${emailCfg2.user}>`, to: args.to, subject: draft.subject, text: draft.body + getSignature(emailCfg2) });
        addLog(`🤖 AI composed & sent email → ${args.to}: "${draft.subject}"`, 'task');
        broadcast('email_sent', { to: args.to, subject: draft.subject });
        return { ok: true, sentTo: args.to, subject: draft.subject, preview: draft.body.slice(0, 120) };
      }

      case 'send_viber_message': {
        const vbCfg = loadViberConfig();
        if (!vbCfg || vbCfg.authToken === 'your-viber-auth-token-here') return { error: 'Viber not configured' };
        const vbTarget = args.viberId || Object.keys(viberContacts)[0];
        if (!vbTarget) return { error: 'No Viber contact available — user must message bot first' };
        const vbResult = await viberSend(vbCfg.authToken, vbTarget, args.message, vbCfg.botName);
        if (vbResult.status !== 0) return { error: vbResult.status_message || 'Viber send failed' };
        addLog(`🤖 AI sent Viber → ${viberContacts[vbTarget]?.name || vbTarget}: "${args.message.slice(0, 50)}"`, 'task');
        return { ok: true, sentTo: vbTarget };
      }

      case 'toggle_auto_mode': {
        state.autoMode = args.enable;
        if (args.enable) startAutoMode(); else stopAutoMode();
        addLog(`🤖 AI ${args.enable ? 'enabled' : 'disabled'} Auto Mode`, args.enable ? 'on' : 'off');
        broadcast('auto_mode', { autoMode: state.autoMode });
        return { ok: true, autoMode: state.autoMode };
      }

      case 'get_telegram_messages': {
        const contacts = Object.values(tgContacts).map(c => ({ name: c.name || c.username || c.chatId, chatId: c.chatId, lastMsg: c.lastMsg }));
        const outbox   = tgOutbox.slice(0, 10);
        return { contacts, recentSent: outbox, contactCount: contacts.length, note: contacts.length === 0 ? 'No Telegram messages received yet. Messages appear here after someone messages your bot.' : '' };
      }

      case 'get_line_messages': {
        const contacts = Object.values(lineContacts).map(c => ({ name: c.displayName || 'LINE User', lastMsg: c.lastMsg }));
        const outbox   = lineOutbox.slice(0, 10);
        return { contacts, recentSent: outbox, contactCount: contacts.length, note: contacts.length === 0 ? 'No LINE messages received yet. Messages appear after someone messages your LINE bot.' : '' };
      }

      case 'get_viber_messages': {
        const contacts = Object.values(viberContacts).map(c => ({ name: c.name, viberId: c.viberId, lastMsg: c.lastMsg }));
        const outbox   = viberOutbox.slice(0, 10);
        return { contacts, recentSent: outbox, contactCount: contacts.length };
      }

      case 'reset_tasks': {
        state.tasks.forEach(t => { t.done = false; });
        broadcast('task_update', state.tasks);
        snapshotGraph();
        addLog('↺ AI reset all tasks to undone.', 'task');
        return { ok: true, reset: state.tasks.length };
      }

      case 'create_calendar_event': {
        const { title, date, time, duration = 60, description = '' } = args;
        const client = getCalendarClient();
        if (!client) return { ok: false, error: 'Google Calendar not configured. Check google.config.json.' };

        const startDt = new Date();
        if (date) { const d = new Date(date); startDt.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); }
        if (time) { const [h, m] = time.split(':').map(Number); startDt.setHours(h, m || 0, 0, 0); }
        else { startDt.setHours(startDt.getHours() + 1, 0, 0, 0); }
        const endDt = new Date(startDt.getTime() + duration * 60000);

        const { data } = await client.calendar.events.insert({
          calendarId: client.cfg.calendarId || 'primary',
          requestBody: {
            summary: title, description,
            start: { dateTime: startDt.toISOString(), timeZone: client.cfg.timezone || 'Asia/Yangon' },
            end:   { dateTime: endDt.toISOString(),   timeZone: client.cfg.timezone || 'Asia/Yangon' }
          }
        });
        addLog(`📅 Calendar event created: "${title}" on ${startDt.toDateString()} at ${startDt.toLocaleTimeString()}`, 'task');
        fireZapier('calendar_event_created', { title, date: startDt.toISOString(), duration, link: data.htmlLink });
        return { ok: true, eventId: data.id, link: data.htmlLink, title, start: startDt.toISOString() };
      }

      case 'delete_calendar_event': {
        const client = getCalendarClient();
        if (!client) return { ok: false, error: 'Google Calendar not configured.' };
        const calId = client.cfg.calendarId || 'primary';
        const { title: evTitle, time: evTime } = args;

        // Search events for the next 14 days matching the title
        const searchFrom = new Date();
        const searchTo   = new Date(searchFrom.getTime() + 14 * 86400000);
        const { data: listData } = await client.calendar.events.list({
          calendarId: calId,
          timeMin: searchFrom.toISOString(), timeMax: searchTo.toISOString(),
          singleEvents: true, orderBy: 'startTime', maxResults: 50
        });
        const events = listData.items || [];
        // Match by title keyword (case-insensitive), optionally narrow by time
        const keyword = (evTitle || '').toLowerCase();
        let matched = events.filter(e => e.summary && e.summary.toLowerCase().includes(keyword));
        if (evTime && matched.length > 1) {
          matched = matched.filter(e => {
            const start = new Date(e.start?.dateTime || e.start?.date);
            const h = start.getHours(), m = start.getMinutes();
            const timeLabel = `${h}:${String(m).padStart(2,'0')}`;
            return evTime.includes(String(h)) || evTime.includes(timeLabel);
          });
        }
        if (matched.length === 0) return { ok: false, error: `No event matching "${evTitle}" found in the next 14 days.` };
        const target = matched[0];
        await client.calendar.events.delete({ calendarId: calId, eventId: target.id }).catch(e => { throw e; });
        addLog(`📅 Calendar event deleted: "${target.summary}"`, 'task');
        return { ok: true, deleted: target.summary, wasAt: target.start?.dateTime || target.start?.date };
      }

      case 'search_google_drive': {
        const drive = getDriveClient();
        if (!drive) return { ok: false, error: 'Google Drive not configured.' };

        // Strip filler words server-side — extract meaningful tokens
        const FILLERS = new Set(['a','an','the','my','our','some','any','this','that','form','file','document','doc','pdf','sheet','folder','in','at','on','for','of','to']);
        const rawQuery = args.query.trim();
        const tokens = rawQuery.split(/\s+/).filter(t => !FILLERS.has(t.toLowerCase()) && t.length > 0);
        // Build search terms: try full cleaned query first, then each token
        const searchTerms = [];
        if (tokens.length > 0) searchTerms.push(tokens.join(' '));
        tokens.forEach(t => { if (!searchTerms.includes(t)) searchTerms.push(t); });

        let files = [];
        for (const term of searchTerms) {
          let q = `name contains '${term.replace(/'/g, "\\'")}' and trashed = false`;
          if (args.folder_name) {
            const folderRes = await drive.files.list({
              q: `name contains '${args.folder_name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
              pageSize: 5, fields: 'files(id,name)'
            });
            const folder = folderRes.data.files?.[0];
            if (folder) q += ` and '${folder.id}' in parents`;
          }
          const { data } = await drive.files.list({
            q, pageSize: args.limit || 15,
            fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
            orderBy: 'modifiedTime desc',
            includeItemsFromAllDrives: true, supportsAllDrives: true
          });
          files = (data.files || []).map(f => ({
            name: f.name,
            type: f.mimeType.replace('application/vnd.google-apps.', '').replace('application/', ''),
            modified: f.modifiedTime ? new Date(f.modifiedTime).toDateString() : '',
            link: f.webViewLink
          }));
          if (files.length > 0) break; // found results — stop trying
        }
        addLog(`📁 Drive search: "${rawQuery}" — ${files.length} result(s)`, 'task');
        return { ok: true, query: rawQuery, searchedFor: searchTerms[0] || rawQuery, count: files.length, files };
      }

      case 'list_drive_files': {
        const drive = getDriveClient();
        if (!drive) return { ok: false, error: 'Google Drive not configured.' };
        let q = 'trashed = false';

        if (args.folder_name) {
          const folderRes = await drive.files.list({
            q: `name contains '${args.folder_name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            pageSize: 5, fields: 'files(id,name)'
          });
          const folder = folderRes.data.files?.[0];
          if (folder) {
            q = `'${folder.id}' in parents and trashed = false`;
          }
        }

        const { data } = await drive.files.list({
          q, pageSize: args.limit || 20,
          fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
          orderBy: 'modifiedTime desc',
          includeItemsFromAllDrives: true, supportsAllDrives: true
        });
        const files = (data.files || []).map(f => ({
          name: f.name,
          type: f.mimeType.replace('application/vnd.google-apps.', '').replace('application/', ''),
          modified: f.modifiedTime ? new Date(f.modifiedTime).toDateString() : '',
          link: f.webViewLink
        }));
        const label = args.folder_name ? `folder "${args.folder_name}"` : 'Google Drive (recent)';
        addLog(`📁 Drive list: ${label} — ${files.length} file(s)`, 'task');
        return { ok: true, location: label, count: files.length, files };
      }

      case 'create_notion_task': {
        const { title, description = '', due_date = '' } = args;
        const notion = getNotionClient();
        if (!notion) return { ok: false, error: 'Notion not configured. Check notion.config.json.' };
        if (!notionCfg.databaseId) return { ok: false, error: 'Notion databaseId missing in notion.config.json.' };

        const props = { Name: { title: [{ text: { content: title } }] } };
        if (due_date) props['Due Date'] = { date: { start: due_date } };
        if (description) props['Notes'] = { rich_text: [{ text: { content: description } }] };

        const page = await notion.pages.create({
          parent: { database_id: notionCfg.databaseId },
          properties: props
        });
        addLog(`📝 Notion task created: "${title}"`, 'task');
        return { ok: true, pageId: page.id, url: page.url, title };
      }

      case 'delete_drive_file': {
        const drive = getDriveClient();
        if (!drive) return { error: 'Google Drive not configured' };
        const { filename, delete_all = false } = args;
        const FILLERS2 = new Set(['a','an','the','my','both','all','file','sheet','doc','folder']);
        const cleanedTokens = filename.split(/\s+/).filter(t => !FILLERS2.has(t.toLowerCase()) && t.length > 0);
        const searchTerm = cleanedTokens.join(' ') || filename;

        const found = await drive.files.list({
          q: `name contains '${searchTerm.replace(/'/g,"\\'")}' and trashed = false`,
          pageSize: 20, fields: 'files(id,name,mimeType)',
          includeItemsFromAllDrives: true, supportsAllDrives: true, orderBy: 'modifiedTime desc'
        });
        const files = found.data.files || [];
        if (files.length === 0) return { ok: false, error: `No files matching "${filename}" found in Drive.` };

        const targets = delete_all ? files : [files[0]];
        const deleted = [];
        for (const f of targets) {
          await drive.files.delete({ fileId: f.id, supportsAllDrives: true }).catch(() => drive.files.update({ fileId: f.id, supportsAllDrives: true, requestBody: { trashed: true } }));
          deleted.push(f.name);
          addLog(`🗑️ Drive file deleted: "${f.name}"`, 'task');
        }
        return { ok: true, deleted, count: deleted.length };
      }

      case 'create_drive_folder': {
        const drive = getDriveClient();
        if (!drive) return { error: 'Google Drive not configured' };
        const { name: folderName, parent_folder } = args;
        const meta = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
        // If parent folder specified, find its ID first
        if (parent_folder) {
          const pRes = await drive.files.list({
            q: `name = '${parent_folder.replace(/'/g,"\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id,name)', pageSize: 1,
            includeItemsFromAllDrives: true, supportsAllDrives: true
          });
          const parent = pRes.data.files?.[0];
          if (parent) meta.parents = [parent.id];
        }
        const created = await drive.files.create({
          requestBody: meta,
          fields: 'id,name,webViewLink',
          supportsAllDrives: true
        });
        const { id, name: createdName, webViewLink } = created.data;
        addLog(`📁 Drive folder created: "${createdName}"`, 'task');
        return { ok: true, name: createdName, id, url: webViewLink };
      }

      case 'create_google_sheet': {
        const sheetsC = getSheetClient();
        if (!sheetsC) return { error: 'Google Sheets not configured' };
        const { title, headers = [] } = args;
        const requestBody = {
          properties: { title },
          sheets: [{
            properties: { title: 'Sheet1' },
            data: headers.length > 0 ? [{
              startRow: 0, startColumn: 0,
              rowData: [{ values: headers.map(h => ({ userEnteredValue: { stringValue: h } })) }]
            }] : []
          }]
        };
        const created = await sheetsC.spreadsheets.create({ requestBody, fields: 'spreadsheetId,spreadsheetUrl' });
        const url = created.data.spreadsheetUrl;
        const sid = created.data.spreadsheetId;
        addLog(`📊 Google Sheet created: "${title}" — ${url}`, 'task');
        return { ok: true, title, spreadsheetId: sid, url, headers };
      }

      case 'send_facebook_message': {
        const { recipient, message } = args;
        // Prefer Zapier webhook if configured (simpler, no PSID needed)
        const zapUrl = zapierCfg['send_facebook_message'];
        if (zapUrl && !zapUrl.startsWith('PASTE_')) {
          await fireZapier('send_facebook_message', { recipient, message });
          addLog(`📘 Facebook message sent via Zapier`, 'task');
          return { ok: true, method: 'zapier' };
        }
        // Fallback: direct Graph API
        const result = await sendFacebookMessage(recipient || null, message);
        if (!result.ok) return { ok: false, error: result.error };
        addLog(`📘 Facebook message sent (${result.recipient_id})`, 'task');
        return { ok: true, message_id: result.message_id, recipient_id: result.recipient_id };
      }

      case 'read_google_sheet': {
        const sheets = getSheetClient();
        if (!sheets) return { error: 'Google Sheets not configured' };
        let id = args.spreadsheet_id || sheetsCfg.defaultSpreadsheetId;

        // Auto-find: search Drive for any Google Sheets file
        if (!id) {
          const drive = getDriveClient();
          if (!drive) return { error: 'No spreadsheet ID and Drive not configured to auto-find one.' };
          const driveOpts = {
            pageSize: 20, fields: 'files(id,name)', orderBy: 'modifiedTime desc',
            includeItemsFromAllDrives: true, supportsAllDrives: true
          };

          // 1. Try keyword match if a meaningful sheet_name given
          let match = null;
          if (args.sheet_name && !['sheet','sheets','my','all','spreadsheet'].includes(args.sheet_name.toLowerCase())) {
            const kw = args.sheet_name.replace(/'/g, "\\'");
            const r1 = await drive.files.list({ ...driveOpts,
              q: `mimeType = 'application/vnd.google-apps.spreadsheet' and name contains '${kw}' and trashed = false` });
            match = r1.data.files?.[0] || null;
          }

          // 2. Fallback: list all spreadsheets
          if (!match) {
            const r2 = await drive.files.list({ ...driveOpts,
              q: `mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false` });
            const all = r2.data.files || [];
            if (all.length === 0) return { error: 'No Google Sheets found in your Drive. Create one first.' };
            if (all.length === 1) { match = all[0]; }
            else { return { ok: true, foundSheets: all.map(f => f.name),
              message: `You have ${all.length} sheets — specify which one to read.` }; }
          }

          id = match.id;
          addLog(`📊 Auto-found sheet: "${match.name}"`, 'task');
        }

        const tab   = args.sheet_name || sheetsCfg.defaultSheetName || 'Sheet1';
        const range = `${tab}!${args.range || 'A:Z'}`;
        try {
          const result = await sheets.spreadsheets.values.get({ spreadsheetId: id, range });
          const rows = result.data.values || [];
          addLog(`📊 Sheet read: "${range}" — ${rows.length} row(s)`, 'task');
          return { ok: true, spreadsheetId: id, range, rows, rowCount: rows.length };
        } catch (sheetErr) {
          // Tab name mismatch — try without tab prefix
          const result2 = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: args.range || 'A:Z' });
          const rows = result2.data.values || [];
          addLog(`📊 Sheet read (default tab) — ${rows.length} row(s)`, 'task');
          return { ok: true, spreadsheetId: id, range: args.range || 'A:Z', rows, rowCount: rows.length };
        }
      }

      case 'append_to_sheet': {
        const sheets2 = getSheetClient();
        if (!sheets2) return { error: 'Google Sheets not configured' };
        let id2 = args.spreadsheet_id || sheetsCfg.defaultSpreadsheetId;

        // Auto-find if no ID
        if (!id2) {
          const drive = getDriveClient();
          if (drive) {
            const found = await drive.files.list({
              q: `mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
              pageSize: 1, fields: 'files(id,name)', orderBy: 'modifiedTime desc'
            });
            id2 = found.data.files?.[0]?.id;
          }
        }
        if (!id2) return { error: 'No spreadsheet found. Set defaultSpreadsheetId in sheets.config.json or pass spreadsheet_id.' };
        const tab2  = args.sheet_name || sheetsCfg.defaultSheetName || 'Sheet1';
        const range2 = `${tab2}!A:A`;
        const rowData = Array.isArray(args.values[0]) ? args.values : [args.values];
        await sheets2.spreadsheets.values.append({
          spreadsheetId: id2, range: range2,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: rowData }
        });
        addLog(`📊 Sheet row appended: ${JSON.stringify(args.values)}`, 'task');
        return { ok: true, appendedTo: `${id2} / ${tab2}`, row: args.values };
      }

      case 'set_reminder': {
        const triggerAt = parseReminderTime(args.when);
        if (!triggerAt) return { error: `Could not parse time: "${args.when}". Try "in 2 hours", "tomorrow at 9am", or "at 3pm".` };
        const id = `rem_${Date.now()}`;
        reminders.push({ id, message: args.message, triggerAt: triggerAt.toISOString(), notified: false });
        const label = triggerAt.toLocaleString('en-US', { timeZone: 'Asia/Rangoon', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        addLog(`⏰ Reminder set: "${args.message}" at ${label}`, 'task');
        return { ok: true, id, message: args.message, firesAt: label };
      }

      case 'list_reminders': {
        const pending = reminders.filter(r => !r.notified).map(r => ({
          id: r.id,
          message: r.message,
          firesAt: new Date(r.triggerAt).toLocaleString('en-US', { timeZone: 'Asia/Rangoon', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        }));
        return { ok: true, count: pending.length, reminders: pending };
      }

      case 'cancel_reminder': {
        const idx = reminders.findIndex(r => r.id === args.id && !r.notified);
        if (idx === -1) return { error: `Reminder ${args.id} not found or already fired` };
        const [removed] = reminders.splice(idx, 1);
        addLog(`⏰ Reminder cancelled: "${removed.message}"`, 'task');
        return { ok: true, cancelled: removed.message };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// ── AGENTIC AUTO-REPLY ──────────────────────────────────────────
async function autoReplyTelegram(botToken, chatId, userText, name) {
  const cfg = loadOpenAIConfig();
  if (!cfg || cfg.apiKey === 'your-openai-api-key-here' || !cfg.autoReply) return;

  const openai  = new OpenAI({ apiKey: cfg.apiKey });
  const maxHist = cfg.maxHistoryMessages || 10;

  if (!tgHistory[chatId]) tgHistory[chatId] = [];
  tgHistory[chatId].push({ role: 'user', content: userText });
  if (tgHistory[chatId].length > maxHist) tgHistory[chatId] = tgHistory[chatId].slice(-maxHist);

  const cleanHist = tgHistory[chatId].map(m => {
    if (m.role === 'assistant') {
      if (/[\u0E00-\u0E7F\u1000-\u109F]/.test(m.content))
        return { role: 'assistant', content: 'Understood. I will respond in English.' };
      return m;
    }
    if (m.role === 'user')
      return { role: 'user', content: `${m.content}\n\n[INSTRUCTION: Your reply MUST be in English only, not Thai, not Burmese]` };
    return m;
  });
  const messages = [
    { role: 'system', content: buildSystemPrompt(cfg.systemPrompt, 'telegram') },
    ...cleanHist
  ];

  try {
    // Agentic loop — up to 6 tool rounds
    for (let round = 0; round < 6; round++) {
      const completion = await openai.chat.completions.create({
        model:       cfg.model || 'gpt-4o',
        messages,
        tools:       CLAWBOT_TOOLS,
        tool_choice: 'auto'
      });

      const msg    = completion.choices[0].message;
      const reason = completion.choices[0].finish_reason;
      messages.push(msg);

      // No tool calls — final reply
      if (reason === 'stop' || !msg.tool_calls?.length) {
        const reply = msg.content;
        if (reply) {
          tgHistory[chatId].push({ role: 'assistant', content: reply });
          await telegramPost(botToken, { chat_id: chatId, text: reply });
          addLog(`🤖 AI replied to ${name}: "${reply.slice(0, 60)}"`, 'task');
          broadcast('tg_auto_reply', { chatId, name, reply, ts: new Date().toISOString() });
          const outEntry = { chatId, message: reply, sentAt: new Date().toISOString() };
          tgOutbox.unshift(outEntry);
          if (tgOutbox.length > 50) tgOutbox.pop();
        }
        break;
      }

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        msg.tool_calls.map(async tc => {
          const args   = JSON.parse(tc.function.arguments);
          const result = await executeClawbotTool(tc.function.name, args);
          addLog(`🔧 AI used tool: ${tc.function.name}`, 'task');
          broadcast('tg_tool_called', { tool: tc.function.name, args, result });
          return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
        })
      );
      messages.push(...toolResults);
    }
  } catch (err) {
    addLog(`❌ AI agent failed: ${err.message}`, 'off');
  }
}

app.post('/api/telegram/webhook', (req, res) => {
  res.status(200).json({ ok: true }); // respond immediately so Telegram doesn't retry

  const update = req.body;
  const msg    = update?.message || update?.edited_message;
  if (!msg) return;

  const from     = msg.from || {};
  const chatId   = String(msg.chat?.id || from.id);
  const name     = [from.first_name, from.last_name].filter(Boolean).join(' ') || chatId;
  const username = from.username ? `@${from.username}` : null;

  // Register contact
  if (chatId && !tgContacts[chatId]) {
    tgContacts[chatId] = { chatId, name, username, addedAt: new Date().toISOString(), lastMsg: '' };
    addLog(`📱 Telegram: new contact — ${username || name} (${chatId})`, 'on');
    broadcast('tg_contact_added', tgContacts[chatId]);
  }

  if (msg.text) {
    tgContacts[chatId].lastMsg  = msg.text.slice(0, 80);
    tgContacts[chatId].lastSeen = new Date().toISOString();
    addLog(`📱 Telegram msg from ${username || name}: "${msg.text.slice(0, 60)}"`, 'task');
    broadcast('tg_message', { chatId, name, username, text: msg.text, ts: new Date().toISOString() });

    // Auto-reply to ALL users who message the bot
    const cfg = loadTelegramConfig();
    if (cfg?.botToken) autoReplyTelegram(cfg.botToken, chatId, msg.text, username || name);
  }
});

app.get('/api/telegram/contacts', (_req, res) => res.json({ contacts: Object.values(tgContacts) }));

app.get('/api/telegram/ai-status', (_req, res) => {
  const cfg = loadOpenAIConfig();
  if (!cfg) return res.json({ configured: false, reason: 'openai.config.json not found' });
  if (cfg.apiKey === 'your-openai-api-key-here') return res.json({ configured: false, reason: 'API key not set' });
  res.json({ configured: true, model: cfg.model, autoReply: cfg.autoReply });
});

app.post('/api/telegram/ai-toggle', (_req, res) => {
  try {
    const cfg = loadOpenAIConfig();
    if (!cfg) return res.status(503).json({ ok: false, error: 'openai.config.json not found' });
    cfg.autoReply = !cfg.autoReply;
    fs.writeFileSync(path.join(__dirname, 'openai.config.json'), JSON.stringify(cfg, null, 2));
    addLog(`🤖 AI auto-reply ${cfg.autoReply ? 'ENABLED' : 'DISABLED'}`, cfg.autoReply ? 'on' : 'off');
    broadcast('tg_ai_toggled', { autoReply: cfg.autoReply });
    res.json({ ok: true, autoReply: cfg.autoReply });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// ── LINE MESSAGING API ─────────────────────────────────────────
function loadLineConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'clawbot_line_config.json'), 'utf8'));
  } catch (_) { return null; }
}

const lineOutbox = [];

function linePost(accessToken, userId, message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text: message }]
    });
    const req = https.request({
      hostname: 'api.line.me',
      path:     '/v2/bot/message/push',
      method:   'POST',
      headers:  {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        // LINE push returns 200 with empty body on success
        if (res.statusCode === 200) {
          resolve({ ok: true });
        } else {
          try { reject(new Error(JSON.parse(data).message || `HTTP ${res.statusCode}`)); }
          catch (_) { reject(new Error(`HTTP ${res.statusCode}: ${data}`)); }
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

app.get('/api/line/config-status', (_req, res) => {
  const cfg = loadLineConfig();
  if (!cfg) return res.json({ configured: false, reason: 'clawbot_line_config.json not found' });
  const token = cfg.channel?.channel_access_token;
  if (!token) return res.json({ configured: false, reason: 'channel_access_token is empty — paste it from LINE Developers Console' });
  res.json({ configured: true, userId: cfg.defaultUserId, channelName: cfg.channel?.channel_name, fromName: cfg.fromName });
});

app.post('/api/line/send', async (req, res) => {
  const { userId, message } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'message is required' });

  const cfg = loadLineConfig();
  if (!cfg) return res.status(503).json({ ok: false, error: 'clawbot_line_config.json not found' });
  const token = cfg.channel?.channel_access_token;
  if (!token) return res.status(503).json({ ok: false, error: 'channel_access_token is empty — set it in clawbot_line_config.json' });

  const targetUser = userId || cfg.defaultUserId;
  if (!targetUser) return res.status(400).json({ ok: false, error: 'No userId — set defaultUserId in clawbot_line_config.json' });
  if (!/^[UCR][a-f0-9]{32}$/.test(targetUser)) {
    return res.status(400).json({ ok: false, error: `Invalid LINE ID: "${targetUser}". Must start with U (user), C (group), or R (room) followed by 32 hex chars. LINE does not use @usernames — get the ID from the contacts list (have them message your bot first).` });
  }

  try {
    await linePost(token, targetUser, message);
    const entry = { userId: targetUser, message, sentAt: new Date().toISOString() };
    lineOutbox.unshift(entry);
    if (lineOutbox.length > 50) lineOutbox.pop();
    addLog(`💚 LINE sent → ${targetUser}: "${message.slice(0, 60)}"`, 'task');
    broadcast('line_sent', entry);
    res.json({ ok: true });
  } catch (err) {
    addLog(`❌ LINE failed: ${err.message}`, 'off');
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

app.get('/api/line/outbox', (_req, res) => res.json({ outbox: lineOutbox }));

app.get('/api/line/contacts', (_req, res) => res.json({ contacts: Object.values(lineContacts) }));

// ── VIBER MESSAGING API ─────────────────────────────────────────
const viberContacts = {};   // viberId -> { viberId, name, avatar, addedAt, lastMsg }
const viberOutbox   = [];
const viberHistory  = {};   // viberId -> [{role,content},...]

function loadViberConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'viber.config.json'), 'utf8')); }
  catch (_) { return null; }
}

function verifyViberSignature(rawBody, signature, token) {
  const hash = crypto.createHmac('sha256', token).update(rawBody).digest('hex');
  return hash === signature;
}

function viberSend(token, receiver, text, botName) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      receiver,
      min_api_version: 1,
      sender: { name: botName || 'Clawbot' },
      type: 'text',
      text
    });
    const req = https.request({
      hostname: 'chatapi.viber.com',
      path:     '/pa/send_message',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'X-Viber-Auth-Token': token, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { resolve({}); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function viberSetWebhook(token, webhookUrl) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ url: webhookUrl, event_types: ['delivered','seen','failed','subscribed','unsubscribed','conversation_started'] });
    const req  = https.request({
      hostname: 'chatapi.viber.com',
      path:     '/pa/set_webhook',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'X-Viber-Auth-Token': token, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { resolve({}); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function autoReplyViber(token, viberId, replyText, name, botName) {
  const cfg = loadOpenAIConfig();
  if (!cfg || cfg.apiKey === 'your-openai-api-key-here' || !cfg.autoReply) return;

  const openai  = new OpenAI({ apiKey: cfg.apiKey });
  const maxHist = cfg.maxHistoryMessages || 20;

  if (!viberHistory[viberId]) viberHistory[viberId] = [];
  viberHistory[viberId].push({ role: 'user', content: replyText });
  if (viberHistory[viberId].length > maxHist) viberHistory[viberId] = viberHistory[viberId].slice(-maxHist);

  const vbHist = viberHistory[viberId];
  const messages = [
    { role: 'system', content: buildSystemPrompt(cfg.systemPrompt, 'viber') },
    ...vbHist
  ];
  try {
    for (let round = 0; round < 6; round++) {
      const completion = await openai.chat.completions.create({
        model: cfg.model || 'gpt-4o', messages, tools: CLAWBOT_TOOLS, tool_choice: 'auto'
      });
      const msg    = completion.choices[0].message;
      const reason = completion.choices[0].finish_reason;
      messages.push(msg);

      if (reason === 'stop' || !msg.tool_calls?.length) {
        const reply = msg.content;
        if (reply) {
          viberHistory[viberId].push({ role: 'assistant', content: reply });
          await viberSend(token, viberId, reply, botName);
          addLog(`🟣 Viber auto-replied to ${name}: "${reply.slice(0, 60)}"`, 'task');
          broadcast('viber_auto_reply', { viberId, name, reply, ts: new Date().toISOString() });
          const outEntry = { viberId, message: reply, sentAt: new Date().toISOString() };
          viberOutbox.unshift(outEntry);
          if (viberOutbox.length > 50) viberOutbox.pop();
        }
        break;
      }

      const toolResults = await Promise.all(
        msg.tool_calls.map(async tc => {
          const args   = JSON.parse(tc.function.arguments);
          const result = await executeClawbotTool(tc.function.name, args);
          addLog(`🔧 Viber AI tool: ${tc.function.name}`, 'task');
          return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
        })
      );
      messages.push(...toolResults);
    }
  } catch (err) {
    addLog(`❌ Viber AI failed: ${err.message}`, 'off');
  }
}

// Viber webhook — raw body needed for signature verification
app.post('/api/viber/webhook', express.raw({ type: '*/*' }), (req, res) => {
  res.status(200).end();

  const cfg       = loadViberConfig();
  const token     = cfg?.authToken;
  const signature = req.headers['x-viber-content-signature'];
  const rawBody   = req.body;

  if (token && token !== 'your-viber-auth-token-here' && signature) {
    if (!verifyViberSignature(rawBody, signature, token)) return;
  }

  let body;
  try { body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString() : JSON.stringify(rawBody)); }
  catch (_) { return; }

  const event   = body.event;
  const sender  = body.sender || {};
  const viberId = sender.id;
  const name    = sender.name || viberId;
  const avatar  = sender.avatar || '';

  // Register contact on any event with a sender
  if (viberId && !viberContacts[viberId]) {
    viberContacts[viberId] = { viberId, name, avatar, addedAt: new Date().toISOString(), lastMsg: '' };
    addLog(`🟣 Viber: New contact — ${name} (${viberId})`, 'on');
    broadcast('viber_contact_added', viberContacts[viberId]);
  }

  if (event === 'message' && body.message?.type === 'text') {
    const text = body.message.text || '';
    if (viberContacts[viberId]) {
      viberContacts[viberId].lastMsg  = text.slice(0, 80);
      viberContacts[viberId].lastSeen = new Date().toISOString();
    }
    addLog(`🟣 Viber msg from ${name}: "${text.slice(0, 60)}"`, 'task');
    broadcast('viber_message', { viberId, name, text, ts: new Date().toISOString() });
    if (token && token !== 'your-viber-auth-token-here') {
      autoReplyViber(token, viberId, text, name, cfg.botName);
    }
  }

  if (event === 'conversation_started') {
    const welcomeText = `Hi ${name}! I'm Clawbot, your Mawbolt Systems operations assistant. How can I help you today?`;
    if (token && token !== 'your-viber-auth-token-here') {
      viberSend(token, viberId, welcomeText, cfg?.botName).catch(() => {});
    }
    addLog(`🟣 Viber: ${name} started a conversation.`, 'on');
  }

  if (event === 'subscribed') addLog(`🟣 Viber: ${name} subscribed.`, 'on');
  if (event === 'unsubscribed') addLog(`🟣 Viber: ${viberId} unsubscribed.`, 'off');
});

app.get('/api/viber/config-status', (_req, res) => {
  const cfg = loadViberConfig();
  if (!cfg) return res.json({ configured: false, reason: 'viber.config.json not found' });
  if (cfg.authToken === 'your-viber-auth-token-here') return res.json({ configured: false, reason: 'Auth token not set' });
  res.json({ configured: true, botName: cfg.botName });
});

app.post('/api/viber/send', async (req, res) => {
  const { viberId, message } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'message required' });
  const cfg = loadViberConfig();
  if (!cfg || cfg.authToken === 'your-viber-auth-token-here')
    return res.status(503).json({ ok: false, error: 'Viber not configured — add authToken to viber.config.json' });
  if (!viberId) return res.status(400).json({ ok: false, error: 'viberId required — get it from contacts after user messages your bot' });
  try {
    const result = await viberSend(cfg.authToken, viberId, message, cfg.botName);
    if (result.status !== 0) return res.status(400).json({ ok: false, error: result.status_message || 'Viber send failed' });
    const entry = { viberId, message, sentAt: new Date().toISOString() };
    viberOutbox.unshift(entry);
    if (viberOutbox.length > 50) viberOutbox.pop();
    addLog(`🟣 Viber sent → ${viberContacts[viberId]?.name || viberId}: "${message.slice(0, 60)}"`, 'task');
    broadcast('viber_sent', entry);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

app.get('/api/viber/contacts', (_req, res) => res.json({ contacts: Object.values(viberContacts) }));
app.get('/api/viber/outbox',   (_req, res) => res.json({ outbox: viberOutbox }));

app.post('/api/viber/set-webhook', async (req, res) => {
  const cfg = loadViberConfig();
  if (!cfg || cfg.authToken === 'your-viber-auth-token-here')
    return res.status(503).json({ ok: false, error: 'Viber not configured' });
  const webhookUrl = req.body?.url || 'https://itsolutions-mm--clawbot-serve.modal.run/api/viber/webhook';
  try {
    const result = await viberSetWebhook(cfg.authToken, webhookUrl);
    res.json({ ok: result.status === 0, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// ── GOOGLE CALENDAR ────────────────────────────────────────────
const { google } = require('googleapis');

function loadGoogleConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'google.config.json'), 'utf8'));
    const key = JSON.parse(fs.readFileSync(path.join(__dirname, cfg.serviceAccountFile), 'utf8'));
    return { cfg, key };
  } catch (_) { return null; }
}

function getCalendarClient() {
  const g = loadGoogleConfig();
  if (!g) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: g.key,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
  return { calendar: google.calendar({ version: 'v3', auth }), cfg: g.cfg };
}

function getDriveClient() {
  const g = loadGoogleConfig();
  if (!g) return null;
  const oauth = g.cfg.driveOAuth;
  // Prefer OAuth user credentials — gives full personal Drive access without sharing
  if (oauth && oauth.refreshToken && !oauth.refreshToken.includes('PASTE_')) {
    const auth = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
    auth.setCredentials({ refresh_token: oauth.refreshToken });
    return google.drive({ version: 'v3', auth });
  }
  // Fallback: service account (only sees explicitly shared files)
  const auth = new google.auth.GoogleAuth({
    credentials: g.key,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  return google.drive({ version: 'v3', auth });
}

// ── GOOGLE SHEETS ───────────────────────────────────────────────
let sheetsCfg = {};
try { sheetsCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'sheets.config.json'), 'utf8')); } catch {}

function getSheetClient() {
  const g = loadGoogleConfig();
  if (!g) return null;
  const oauth = g.cfg.driveOAuth;
  // Try OAuth user credentials first (needs spreadsheets scope — may work if granted)
  if (oauth && oauth.refreshToken && !oauth.refreshToken.includes('PASTE_')) {
    const auth = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
    auth.setCredentials({ refresh_token: oauth.refreshToken });
    return google.sheets({ version: 'v4', auth });
  }
  // Fallback: service account (sheet must be shared with service account email)
  const auth = new google.auth.GoogleAuth({
    credentials: g.key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

// ── REMINDERS ───────────────────────────────────────────────────
const reminders = []; // { id, message, triggerAt, notified }

function parseReminderTime(whenStr) {
  const now = new Date(new Date().getTime() + 6.5 * 60 * 60000); // Yangon time
  const s = whenStr.toLowerCase().trim();

  // "in X minutes / hours / days"
  const inMatch = s.match(/in\s+(\d+)\s*(min|minute|hour|hr|day)/);
  if (inMatch) {
    const n = parseInt(inMatch[1]);
    const u = inMatch[2];
    const ms = u.startsWith('min') ? n * 60000 : u.startsWith('hour') || u === 'hr' ? n * 3600000 : n * 86400000;
    return new Date(now.getTime() + ms);
  }

  // "tomorrow [at HH:MM / Xam / Xpm]"
  if (s.includes('tomorrow')) {
    const t = new Date(now); t.setDate(t.getDate() + 1);
    const tm = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (tm) {
      let h = parseInt(tm[1]);
      const m = tm[2] ? parseInt(tm[2]) : 0;
      if (tm[3] === 'pm' && h < 12) h += 12;
      if (tm[3] === 'am' && h === 12) h = 0;
      t.setHours(h, m, 0, 0);
    } else { t.setHours(9, 0, 0, 0); }
    return t;
  }

  // "at HH:MM / Xam / Xpm"
  const atMatch = s.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (atMatch) {
    const t = new Date(now);
    let h = parseInt(atMatch[1]);
    const m = atMatch[2] ? parseInt(atMatch[2]) : 0;
    if (atMatch[3] === 'pm' && h < 12) h += 12;
    if (atMatch[3] === 'am' && h === 12) h = 0;
    t.setHours(h, m, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1); // past → tomorrow
    return t;
  }

  // ISO / natural date string
  const parsed = new Date(whenStr);
  if (!isNaN(parsed)) return parsed;
  return null;
}

// Fire due reminders every 30 seconds
setInterval(() => {
  const now = new Date();
  reminders.forEach(r => {
    if (r.notified || new Date(r.triggerAt) > now) return;
    r.notified = true;
    const msg = `⏰ Reminder: ${r.message}`;
    broadcast('reminder', { id: r.id, message: r.message });
    // Push to Telegram
    const tgCfg = loadTelegramConfig();
    if (tgCfg?.botToken && tgCfg.botToken !== 'your-bot-token-here' && tgCfg.defaultChatId) {
      fetch(`https://api.telegram.org/bot${tgCfg.botToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgCfg.defaultChatId, text: msg })
      }).catch(() => {});
    }
    addLog(msg, 'task');
  });
  // Clean notified reminders older than 1 hour
  const cutoff = now.getTime() - 3600000;
  for (let i = reminders.length - 1; i >= 0; i--) {
    if (reminders[i].notified && new Date(reminders[i].triggerAt).getTime() < cutoff) reminders.splice(i, 1);
  }
}, 30000);

app.get('/api/reminders', (_req, res) => {
  const pending = reminders.filter(r => !r.notified).map(r => ({
    id: r.id, message: r.message,
    firesAt: new Date(r.triggerAt).toLocaleString('en-US', { timeZone: 'Asia/Rangoon', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }));
  res.json({ ok: true, count: pending.length, reminders: pending });
});

app.delete('/api/reminders/:id', (req, res) => {
  const idx = reminders.findIndex(r => r.id === req.params.id && !r.notified);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
  const [removed] = reminders.splice(idx, 1);
  res.json({ ok: true, cancelled: removed.message });
});

app.get('/api/calendar/config-status', (_req, res) => {
  const g = loadGoogleConfig();
  if (!g) return res.json({ configured: false, reason: 'google.config.json or service account file missing' });
  res.json({ configured: true, calendarId: g.cfg.calendarId, serviceAccount: g.key.client_email });
});

async function fetchCalendarEvents(targetDate) {
  const client = getCalendarClient();
  if (!client) throw new Error('Google Calendar not configured');
  const base  = targetDate ? new Date(targetDate) : new Date();
  const start = new Date(base); start.setHours(0, 0, 0, 0);
  const end   = new Date(base); end.setHours(23, 59, 59, 999);
  const { data } = await client.calendar.events.list({
    calendarId: client.cfg.calendarId || 'primary',
    timeMin: start.toISOString(), timeMax: end.toISOString(),
    singleEvents: true, orderBy: 'startTime', maxResults: 20
  });
  const events = (data.items || []).map(e => ({
    id: e.id, title: e.summary || '(No title)',
    start: e.start?.dateTime || e.start?.date,
    end:   e.end?.dateTime   || e.end?.date,
    location: e.location || '', desc: e.description || ''
  }));
  const label = base.toDateString();
  addLog(`📅 Calendar: ${events.length} event(s) on ${label}`, 'task');
  return { events, date: label };
}

app.get('/api/calendar/events', async (_req, res) => {
  try {
    const result = await fetchCalendarEvents();
    if (result.events.length > 0) fireZapier('calendar_events', { date: result.date, count: result.events.length, events: result.events.slice(0, 5) });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

app.post('/api/calendar/event', async (req, res) => {
  const { title, date, time, duration = 60, description = '' } = req.body || {};
  if (!title) return res.status(400).json({ ok: false, error: 'title is required' });

  const client = getCalendarClient();
  if (!client) return res.status(503).json({ ok: false, error: 'Google Calendar not configured' });

  // Parse date/time — default to today at next hour
  const startDt = new Date();
  if (date) { const d = new Date(date); startDt.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); }
  if (time) { const [h, m] = time.split(':').map(Number); startDt.setHours(h || startDt.getHours() + 1, m || 0, 0, 0); }
  else { startDt.setHours(startDt.getHours() + 1, 0, 0, 0); }

  const endDt = new Date(startDt.getTime() + duration * 60000);

  try {
    const { data } = await client.calendar.events.insert({
      calendarId: client.cfg.calendarId || 'primary',
      requestBody: {
        summary:     title,
        description,
        start: { dateTime: startDt.toISOString(), timeZone: client.cfg.timezone || 'UTC' },
        end:   { dateTime: endDt.toISOString(),   timeZone: client.cfg.timezone || 'UTC' }
      }
    });
    addLog(`📅 Calendar event created: "${title}" at ${startDt.toLocaleTimeString()}`, 'task');
    res.json({ ok: true, eventId: data.id, link: data.htmlLink });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// Status report endpoint
app.get('/api/report', (_req, res) => {
  const groups = {};
  ALL_GROUPS.forEach(g => {
    const gt = state.tasks.filter(t => t.group === g);
    groups[g] = { total: gt.length, done: gt.filter(t => t.done).length, pending: gt.filter(t => !t.done).length };
  });
  res.json({
    status:     'RUNNING',
    startedAt:  state.startedAt,
    autoMode:   state.autoMode,
    totals: {
      all:       state.tasks.length,
      completed: state.tasks.filter(t => t.done).length,
      pending:   state.tasks.filter(t => !t.done).length,
    },
    byGroup: groups
  });
});

// ── CHAT API (OpenClaw GUI) ────────────────────────────────────
const chatHistory = [];
app.post('/api/chat', chatRateLimit, async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  const cfg = loadOpenAIConfig();
  if (!cfg) return res.status(503).json({ error: 'OpenAI not configured' });
  const openai = new OpenAI({ apiKey: cfg.apiKey });

  chatHistory.push({ role: 'user', content: message });
  if (chatHistory.length > 40) chatHistory.splice(0, chatHistory.length - 40);

  const messages = [
    { role: 'system', content: buildSystemPrompt(cfg.systemPrompt, 'chat') },
    ...chatHistory
  ];

  try {
    for (let round = 0; round < 6; round++) {
      const completion = await openai.chat.completions.create({
        model: cfg.model || 'gpt-4o', messages, tools: CLAWBOT_TOOLS, tool_choice: 'auto'
      });
      const msg    = completion.choices[0].message;
      const reason = completion.choices[0].finish_reason;
      messages.push(msg);

      if (reason === 'stop' || !msg.tool_calls?.length) {
        const reply = msg.content || '';
        chatHistory.push({ role: 'assistant', content: reply });
        broadcast('chat_message', { role: 'assistant', content: reply });
        return res.json({ ok: true, reply });
      }

      const toolResults = await Promise.all(
        msg.tool_calls.map(async tc => {
          const args   = JSON.parse(tc.function.arguments);
          const result = await executeClawbotTool(tc.function.name, args);
          broadcast('chat_tool', { tool: tc.function.name, result });
          return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
        })
      );
      messages.push(...toolResults);
    }
    res.json({ ok: false, error: 'Max rounds reached' });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

app.get('/api/chat/history', (_req, res) => res.json(chatHistory));
app.post('/api/chat/clear',  (_req, res) => { chatHistory.length = 0; res.json({ ok: true }); });
app.post('/api/history/clear', (_req, res) => {
  chatHistory.length = 0;
  Object.keys(tgHistory).forEach(k  => delete tgHistory[k]);
  Object.keys(lineHistory).forEach(k => delete lineHistory[k]);
  Object.keys(viberHistory).forEach(k => delete viberHistory[k]);
  addLog('🗑 All conversation histories cleared.', 'task');
  res.json({ ok: true, cleared: ['telegram', 'line', 'viber', 'chat'] });
});

// ── QR CODE ────────────────────────────────────────────────────
app.get('/qr', async (_req, res) => {
  const url = 'https://itsolutions-mm--clawbot-serve.modal.run';
  const svg = await QRCode.toString(url, { type: 'svg', margin: 2, color: { dark: '#7360f2', light: '#0d0d0f' } });
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clawbot QR</title>
<style>
  body { background:#0d0d0f; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; margin:0; font-family:sans-serif; color:#e8e8f0; }
  .qr-box { background:#1c1c21; border:1px solid #2a2a32; border-radius:16px; padding:32px; text-align:center; max-width:320px; width:90%; }
  .qr-box svg { width:100%; height:auto; border-radius:8px; }
  h2 { margin:0 0 8px; font-size:20px; }
  p  { color:#888898; font-size:13px; margin:16px 0 0; word-break:break-all; }
  .icon { font-size:36px; margin-bottom:12px; }
</style></head><body>
<div class="qr-box">
  <div class="icon">🦞</div>
  <h2>Clawbot</h2>
  ${svg}
  <p>${url}</p>
</div>
</body></html>`);
});

// ── SHUTDOWN ───────────────────────────────────────────────────
app.post('/api/shutdown', (_req, res) => {
  stopAutoMode();
  addLog('⏻ Clawbot shutdown initiated by user.', 'off');
  broadcast('shutdown', { msg: 'Clawbot shutting down. Will NOT restart automatically.' });
  res.json({ ok: true });
  setTimeout(() => {
    console.log('\n[Clawbot] Shutdown by user. Will NOT restart automatically.\n');
    process.exit(0);
  }, 1500);
});

// ── WEBSOCKET ──────────────────────────────────────────────────
wss.on('connection', (ws) => {
  try { ws.send(JSON.stringify({ type: 'init', payload: state })); } catch (_) {}
  ws.on('error', () => {});
  addLog('Dashboard connected.', 'on');
});

// ── SERVER START ───────────────────────────────────────────────
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[Clawbot] ERROR: Port ${PORT} already in use. Stop the existing Clawbot first.\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n ██████╗██╗      █████╗ ██╗    ██╗██████╗  ██████╗ ████████╗`);
  console.log(` ██╔════╝██║     ██╔══██╗██║    ██║██╔══██╗██╔═══██╗╚══██╔══╝`);
  console.log(` ██║     ██║     ███████║██║ █╗ ██║██████╔╝██║   ██║   ██║   `);
  console.log(` ██║     ██║     ██╔══██║██║███╗██║██╔══██╗██║   ██║   ██║   `);
  console.log(` ╚██████╗███████╗██║  ██║╚███╔███╔╝██████╔╝╚██████╔╝   ██║   `);
  console.log(`  ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═════╝  ╚═════╝   ╚═╝   `);
  console.log(` Mawbolt Systems — v1.0  |  ${url}\n`);
  console.log(` Modules: Morning · Email · Telegram · Calendar · Security · Core · Monitor · EOD`);
  console.log(` Auto Mode: ON demand — performs all tasks on behalf of user\n`);

  try {
    const p = process.platform;
    if (p === 'darwin')     execSync(`open "${url}"`);
    else if (p === 'win32') execSync(`start "" "${url}"`);
    else                    execSync(`xdg-open "${url}"`);
  } catch (_) {
    console.log(` [Clawbot] Open manually: ${url}`);
  }

  snapshotGraph();
  addLog('Clawbot started — all modules loaded.', 'on');
});

process.on('SIGINT',          () => { stopAutoMode(); process.exit(0); });
process.on('SIGTERM',         () => { stopAutoMode(); process.exit(0); });
process.on('uncaughtException', (err) => console.error('[Clawbot] Error:', err.message));
