'use strict';
/* ============================================================
   CLAWBOT GUI — OpenClaw-style chat interface
   Connects to Clawbot server WebSocket + /api/chat endpoint
   ============================================================ */

// ── API AUTH ────────────────────────────────────────────────────
let API_KEY = localStorage.getItem('clawbot_api_key') || '';
// Auto-fetch key from server on first load (server returns it from auth.config.json)
if (!API_KEY) {
  fetch('/api/auth/key').then(r => r.json()).then(d => {
    if (d.apiKey) { API_KEY = d.apiKey; localStorage.setItem('clawbot_api_key', d.apiKey); }
  }).catch(() => {});
}
function apiFetch(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), 'X-Api-Key': API_KEY };
  return fetch(url, opts);
}

// ── WS CONNECTION ──────────────────────────────────────────────
const WS_PROTO = location.protocol === 'https:' ? 'wss' : 'ws';
const WS_URL   = `${WS_PROTO}://${location.host}/ws`;
let ws, tasks = [], logs = [];

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => setStatus(true);
  ws.onclose = () => { setStatus(false); setTimeout(connectWS, 3000); };
  ws.onerror = () => { setStatus(false); };
  ws.onmessage = (e) => {
    try { handleWS(JSON.parse(e.data)); } catch (_) {}
  };
}

function handleWS(msg) {
  switch (msg.type) {
    case 'init':
      tasks = msg.payload.tasks || [];
      logs  = msg.payload.log   || [];
      renderTasks();
      renderLog();
      break;
    case 'task_update':
      if (Array.isArray(msg.payload)) {
        tasks = msg.payload;
      } else {
        const idx = tasks.findIndex(t => t.id === msg.payload.id);
        if (idx >= 0) tasks[idx] = msg.payload; else tasks.push(msg.payload);
      }
      renderTasks();
      break;
    case 'task_added':
      tasks.push(msg.payload);
      renderTasks();
      break;
    case 'log':
      logs.unshift(msg.payload);
      if (logs.length > 200) logs.pop();
      prependLog(msg.payload);
      break;
    case 'chat_message':
      if (msg.payload.role === 'assistant') removeThinking();
      break;
    case 'chat_tool':
      appendTool(msg.payload.tool);
      break;
  }
}

function setStatus(on) {
  const cls = 'status-dot ' + (on ? 'on' : 'off');
  document.getElementById('statusDot').className = cls;
  const dm = document.getElementById('statusDotMobile');
  if (dm) dm.className = cls;
  const st = document.getElementById('statusText');
  if (st) st.textContent = on ? 'Connected' : 'Reconnecting…';
}

// ── NAVIGATION ─────────────────────────────────────────────────
function switchView(view) {
  document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll(`[data-view="${view}"]`).forEach(b => b.classList.add('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
}

function goHome() {
  switchView('chat');
  const msgs = document.getElementById('chatMessages');
  msgs.innerHTML = welcomeHTML();
  bindSuggestions();
  apiFetch('/api/chat/clear', { method: 'POST' });
}

// Desktop nav
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'chat' && btn.classList.contains('active')) { goHome(); return; }
    switchView(btn.dataset.view);
  });
});

// Mobile nav
document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'menu') { openSheet(); return; }
    if (btn.dataset.view === 'chat' && btn.classList.contains('active')) { goHome(); return; }
    switchView(btn.dataset.view);
  });
});

document.querySelector('.sidebar-brand').addEventListener('click', goHome);

// ── MOBILE ACTION SHEET ─────────────────────────────────────────
const sheet        = document.getElementById('mobileSheet');
const sheetOverlay = document.getElementById('sheetOverlay');
function openSheet()  { sheet?.classList.add('open'); sheetOverlay?.classList.add('open'); }
function closeSheet() { sheet?.classList.remove('open'); sheetOverlay?.classList.remove('open'); }
document.getElementById('sheetClose')?.addEventListener('click', closeSheet);
sheetOverlay?.addEventListener('click', closeSheet);

// ── SIDEBAR + SHEET ACTIONS ─────────────────────────────────────
function doAutoStart() { apiFetch('/api/auto/start', { method: 'POST' }); appendAssistant('▶ Auto Mode started — running all tasks automatically.'); closeSheet(); }
function doAutoStop()  { apiFetch('/api/auto/stop',  { method: 'POST' }); appendAssistant('⏹ Auto Mode stopped.'); closeSheet(); }
function doReset()     { if (!confirm('Reset all tasks to undone?')) return; apiFetch('/api/reset', { method: 'POST' }); appendAssistant('↺ All tasks reset.'); closeSheet(); }
function doClearChat() {
  apiFetch('/api/chat/clear', { method: 'POST' });
  const msgs = document.getElementById('chatMessages');
  msgs.innerHTML = welcomeHTML(); bindSuggestions(); closeSheet();
}

document.getElementById('autoStartBtn')?.addEventListener('click', doAutoStart);
document.getElementById('autoStopBtn')?.addEventListener('click', doAutoStop);
document.getElementById('resetBtn')?.addEventListener('click', doReset);
document.getElementById('clearChatBtn')?.addEventListener('click', doClearChat);
document.getElementById('autoStartBtnM')?.addEventListener('click', doAutoStart);
document.getElementById('autoStopBtnM')?.addEventListener('click', doAutoStop);
document.getElementById('resetBtnM')?.addEventListener('click', doReset);
document.getElementById('clearChatBtnM')?.addEventListener('click', doClearChat);

document.getElementById('clearLogBtn')?.addEventListener('click', () => {
  document.getElementById('logList').innerHTML = '';
  logs = [];
});

// ── CHAT ───────────────────────────────────────────────────────
const chatInput = document.getElementById('chatInput');
const sendBtn   = document.getElementById('sendBtn');

function welcomeHTML() {
  return `<div class="chat-welcome">
    <div class="welcome-glow"></div>
    <div class="welcome-icon">🦞</div>
    <div class="welcome-title">Clawbot is ready</div>
    <div class="welcome-sub">Your 24/7 AI operations agent — email, calendar, messaging, files, tasks.</div>
    <div class="welcome-powered">Powered by GPT-4o · itsolutions.mm</div>
    <div class="welcome-suggestions">
      <button class="suggestion" data-msg="Check my email today">📧 Check email</button>
      <button class="suggestion" data-msg="What's on my calendar today?">📅 Calendar</button>
      <button class="suggestion" data-msg="Show all task status">📋 Task status</button>
      <button class="suggestion" data-msg="Generate end-of-day report">📄 EOD report</button>
      <button class="suggestion" data-msg="Start auto mode and run all tasks">▶ Auto mode</button>
      <button class="suggestion" data-msg="Check Telegram messages">💬 Telegram</button>
      <button class="suggestion" data-msg="Check LINE messages">💚 LINE</button>
      <button class="suggestion" data-msg="Show my recent Drive files">📁 Drive</button>
      <button class="suggestion" data-msg="Send Facebook message">📘 Facebook</button>
    </div>
  </div>`;
}

function bindSuggestions() {
  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => sendMessage(btn.dataset.msg));
  });
}

function appendUser(text) {
  const msgs = document.getElementById('chatMessages');
  const welcome = msgs.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  const div = document.createElement('div');
  div.className = 'msg user';
  div.innerHTML = `<div class="msg-avatar">👤</div><div class="msg-bubble">${escHtml(text)}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function appendAssistant(text) {
  removeThinking();
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.innerHTML = `<div class="msg-avatar">🦞</div><div class="msg-bubble">${escHtml(text)}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function appendTool(toolName) {
  const msgs = document.getElementById('chatMessages');
  const last = msgs.querySelector('.msg.assistant:last-child .msg-bubble');
  if (last) {
    const t = document.createElement('div');
    t.className = 'msg-tool';
    t.textContent = `⚙ ${toolName}`;
    last.appendChild(t);
  }
}

function showThinking() {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg assistant thinking-msg';
  div.innerHTML = `<div class="msg-avatar">🦞</div>
    <div class="msg-thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeThinking() {
  document.querySelectorAll('.thinking-msg').forEach(el => el.remove());
}

async function sendMessage(text) {
  text = (text || chatInput.value).trim();
  if (!text) return;
  chatInput.value = '';
  autoResize();
  sendBtn.disabled = true;
  appendUser(text);
  showThinking();

  try {
    const res  = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    removeThinking();
    if (data.reply) appendAssistant(data.reply);
    else if (data.error) appendAssistant('❌ ' + data.error);
  } catch (err) {
    removeThinking();
    appendAssistant('❌ Connection error. Is the server running?');
  } finally {
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

sendBtn.addEventListener('click', () => sendMessage());
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
chatInput.addEventListener('input', autoResize);

// ── FILE UPLOAD TO DRIVE ────────────────────────────────────────
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files);
  if (!files.length) return;
  fileInput.value = '';

  for (const file of files) {
    appendUser(`📎 Uploading "${file.name}"…`);
    showThinking();
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await apiFetch('/api/drive/upload', { method: 'POST', body: fd });
      const data = await res.json();
      removeThinking();
      if (data.ok) {
        appendAssistant(`✅ "${data.name}" uploaded to Google Drive.\n🔗 ${data.url}`);
      } else {
        appendAssistant(`❌ Upload failed: ${data.error}`);
      }
    } catch {
      removeThinking();
      appendAssistant('❌ Upload error. Is the server running?');
    }
  }
});

function autoResize() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
}

// ── TASKS ──────────────────────────────────────────────────────
const GROUP_META = {
  morning:  { label: 'Morning',     icon: '☀️', sub: 'Daily startup'      },
  email:    { label: 'Email',       icon: '📧', sub: 'Gmail & inbox'       },
  telegram: { label: 'Telegram',    icon: '💬', sub: 'Messages'            },
  line:     { label: 'LINE',        icon: '💚', sub: 'LINE chat'           },
  viber:    { label: 'Viber',       icon: '📱', sub: 'Viber messages'      },
  calendar: { label: 'Calendar',    icon: '📅', sub: 'Google Calendar'     },
  security: { label: 'Security',    icon: '🔒', sub: 'Auth & access'       },
  core:     { label: 'Core',        icon: '⚡', sub: 'System tasks'        },
  monitor:  { label: 'Monitor',     icon: '👁', sub: 'Health checks'       },
  eod:      { label: 'End of Day',  icon: '📄', sub: 'EOD report'          },
};

function renderTasks() {
  const container = document.getElementById('taskGroups');
  const done  = tasks.filter(t => t.done).length;
  const total = tasks.length;
  document.getElementById('taskSummary').textContent = `${done} / ${total} completed`;
  document.getElementById('taskBadge').textContent   = `${done}/${total}`;
  const mb = document.getElementById('taskBadgeMobile');
  if (mb) { mb.textContent = total - done; mb.style.display = (total - done > 0) ? 'flex' : 'none'; }

  const groups = {};
  tasks.forEach(t => {
    if (!groups[t.group]) groups[t.group] = [];
    groups[t.group].push(t);
  });

  container.innerHTML = '';
  Object.entries(groups).forEach(([g, gtasks]) => {
    const meta  = GROUP_META[g] || { label: g, icon: '📌', sub: '' };
    const gdone = gtasks.filter(t => t.done).length;
    const pct   = gtasks.length ? Math.round((gdone / gtasks.length) * 100) : 0;
    const sec   = document.createElement('div');
    sec.className = 'task-group';
    sec.dataset.group = g;
    sec.innerHTML = `
      <div class="task-group-header">
        <div class="task-group-icon">${meta.icon}</div>
        <div class="task-group-info">
          <div class="task-group-name">${meta.label}</div>
          <div class="task-group-sub">${meta.sub}</div>
        </div>
        <span class="task-group-count">${gdone}/${gtasks.length}</span>
      </div>
      <div class="task-group-bar"><div class="task-group-bar-fill" style="width:${pct}%"></div></div>
      ${gtasks.map(t => `
        <div class="task-item ${t.done ? 'done' : ''}" data-id="${t.id}">
          <div class="task-check">${t.done ? '✓' : ''}</div>
          <div class="task-name">${escHtml(t.name)}</div>
          <div class="task-tag">${t.tag || ''}</div>
        </div>
      `).join('')}
    `;
    sec.querySelectorAll('.task-item').forEach(el => {
      el.addEventListener('click', () => toggleTask(el.dataset.id));
    });
    container.appendChild(sec);
  });
}

async function toggleTask(id) {
  await fetch(`/api/task/${id}/toggle`, { method: 'POST' });
}

// ── LOG ────────────────────────────────────────────────────────
function renderLog() {
  const list = document.getElementById('logList');
  list.innerHTML = '';
  logs.slice().reverse().forEach(entry => list.appendChild(logEl(entry)));
}

function prependLog(entry) {
  const list = document.getElementById('logList');
  list.insertBefore(logEl(entry), list.firstChild);
}

function logEl(entry) {
  const div = document.createElement('div');
  div.className = `log-entry kind-${entry.kind || ''}`;
  const ts = new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false });
  div.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg">${escHtml(entry.msg)}</span>`;
  return div;
}

// ── UTILS ──────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── KEYBOARD FIX (iOS Safari) ───────────────────────────────────
// Uses position:fixed + dynamic bottom on mobile so keyboard never covers input
if (window.visualViewport) {
  const inputArea = document.querySelector('.chat-input-area');

  function onViewportChange() {
    if (window.innerWidth > 700) { inputArea.style.bottom = ''; return; }
    const vv = window.visualViewport;
    // keyboard height = layout viewport height − visual viewport height
    const kbH = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    if (kbH > 50) {
      inputArea.style.bottom = kbH + 'px';
      const msgs = document.getElementById('chatMessages');
      if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 80);
    } else {
      inputArea.style.bottom = '';
    }
  }

  window.visualViewport.addEventListener('resize', onViewportChange);
  window.visualViewport.addEventListener('scroll', onViewportChange);
}

// ── INIT ───────────────────────────────────────────────────────
document.getElementById('chatMessages').innerHTML = welcomeHTML();
bindSuggestions();
connectWS();
