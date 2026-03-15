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
      <button class="suggestion" data-msg="Check slack messages">💬 Slack</button>
      <button class="suggestion" data-msg="Check notion tasks">📝 Notion</button>
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

// ── INTEGRATIONS VIEW ───────────────────────────────────────────
async function loadIntegrations() {
  const grid = document.getElementById('integrationsGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="int-loading">Loading…</div>';
  try {
    const res  = await apiFetch('/api/integrations/status');
    const data = await res.json();
    grid.innerHTML = '';
    Object.entries(data).forEach(([key, svc]) => {
      const card = document.createElement('div');
      card.className = `int-card ${svc.ok ? 'connected' : 'disconnected'}`;
      card.innerHTML = `
        <div class="int-card-top">
          <span class="int-icon">${svc.icon}</span>
          <span class="int-dot ${svc.ok ? 'on' : 'off'}"></span>
        </div>
        <div class="int-label">${svc.label}</div>
        <div class="int-status">${svc.ok ? 'Connected' : 'Not configured'}</div>
        ${svc.ok && ['telegram','slack','notion','google'].includes(key) ? `<button class="int-test-btn" data-svc="${key}">Test</button>` : ''}
      `;
      grid.appendChild(card);
    });
    grid.querySelectorAll('.int-test-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.textContent = '…';
        btn.disabled = true;
        try {
          const r = await apiFetch(`/api/integrations/test/${btn.dataset.svc}`, { method: 'POST' });
          const d = await r.json();
          btn.textContent = d.ok ? `✓ ${d.detail}` : `✗ ${d.error}`;
          btn.className = 'int-test-btn ' + (d.ok ? 'success' : 'fail');
        } catch {
          btn.textContent = '✗ Error';
          btn.className = 'int-test-btn fail';
        }
      });
    });
  } catch {
    grid.innerHTML = '<div class="int-loading">Failed to load</div>';
  }
}

document.getElementById('refreshIntegrationsBtn')?.addEventListener('click', loadIntegrations);

// Load integrations when switching to that view
document.querySelectorAll('[data-view="integrations"]').forEach(btn => {
  btn.addEventListener('click', () => setTimeout(loadIntegrations, 50));
});

// ── JOB SEARCH VIEW ──────────────────────────────────────────
function scoreClass(s) {
  if (s >= 75) return 'high';
  if (s >= 50) return 'mid';
  return 'low';
}

function renderJobCard(job, idx) {
  const score = job.fit_score || 0;
  const typeClass = (job.type || '').toLowerCase().includes('remote') ? 'remote' : 'onsite';
  const platClass = (job.platform || '').toLowerCase();
  const tags = (job.tech_stack || []).slice(0, 6).map(t => `<span class="job-tag">${t}</span>`).join('');
  const cardId = `job-card-${idx}`;
  return `
    <div class="job-card" id="${cardId}">
      <div class="job-card-top">
        <div class="job-title">${job.title || 'Untitled'}</div>
        <span class="job-score ${scoreClass(score)}">${score}/100</span>
      </div>
      <div class="job-meta">
        <span>${job.company || 'Unknown company'}</span>
        <span>📍 ${job.location || '—'}</span>
        <span class="job-badge ${typeClass}">${job.type || 'Unknown'}</span>
        <span class="job-badge ${platClass}">${job.platform || ''}</span>
      </div>
      <div class="job-summary">${job.summary || ''}</div>
      ${tags ? `<div class="job-tech">${tags}</div>` : ''}
      <div class="job-footer">
        <div>
          <div class="job-salary">${job.salary || 'Salary not specified'}</div>
          ${job.contact && job.contact !== 'Apply via link' ? `<div class="job-contact">Contact: ${job.contact}</div>` : ''}
        </div>
        <div class="job-actions">
          <button class="job-action-btn apply-btn" onclick="toggleApplyPanel('${cardId}', ${idx})">📝 Apply</button>
          <button class="job-action-btn share-btn" onclick="toggleSharePanel('${cardId}', ${idx})">📧 Share</button>
          ${job.apply_url ? `<a class="job-apply-btn" href="${job.apply_url}" target="_blank" rel="noopener">Open →</a>` : ''}
        </div>
      </div>

      <!-- Apply panel (hidden by default) -->
      <div class="job-panel apply-panel" id="${cardId}-apply" style="display:none">
        <div class="panel-label">📝 Cover Letter</div>
        <div class="panel-hint-row">
          <input type="text" class="panel-hint-input" id="${cardId}-hint" placeholder="Optional note to add (e.g. 'mention AWS experience')" />
          <button class="panel-gen-btn" onclick="generateApply('${cardId}', ${idx})">Generate</button>
        </div>
        <div class="panel-cover-letter" id="${cardId}-cover" style="display:none"></div>
        <div class="panel-apply-actions" id="${cardId}-apply-actions" style="display:none"></div>
      </div>

      <!-- Share panel (hidden by default) -->
      <div class="job-panel share-panel" id="${cardId}-share" style="display:none">
        <div class="panel-label">📧 Share via Gmail</div>
        <div class="panel-share-row">
          <input type="email" class="panel-share-input" id="${cardId}-shareto" placeholder="recipient@email.com" />
          <button class="panel-send-btn" onclick="sendShareEmail('${cardId}', ${idx})">Send</button>
        </div>
        <div class="panel-share-status" id="${cardId}-share-status"></div>
      </div>
    </div>`;
}

// Store job data for apply/share actions
let _jobCache = [];

function toggleApplyPanel(cardId, _idx) {
  const panel = document.getElementById(`${cardId}-apply`);
  const sharePanel = document.getElementById(`${cardId}-share`);
  if (sharePanel) sharePanel.style.display = 'none';
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function toggleSharePanel(cardId, _idx) {
  const panel = document.getElementById(`${cardId}-share`);
  const applyPanel = document.getElementById(`${cardId}-apply`);
  if (applyPanel) applyPanel.style.display = 'none';
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  // Pre-fill with user's email from config (try to get from status)
  panel.style.display = 'block';
}

async function generateApply(cardId, idx) {
  const job = _jobCache[idx];
  if (!job) return;
  const hint = document.getElementById(`${cardId}-hint`)?.value || '';
  const coverEl = document.getElementById(`${cardId}-cover`);
  const actionsEl = document.getElementById(`${cardId}-apply-actions`);
  const btn = document.querySelector(`#${cardId}-apply .panel-gen-btn`);

  btn.textContent = 'Generating…';
  btn.disabled = true;
  coverEl.style.display = 'none';
  actionsEl.style.display = 'none';

  try {
    const res = await apiFetch('/api/jobs/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job, hint })
    });
    const data = await res.json();
    if (!data.ok) {
      coverEl.style.display = 'block';
      coverEl.textContent = `Error: ${data.error}`;
      return;
    }
    coverEl.style.display = 'block';
    coverEl.textContent = data.coverLetter;

    // Build action buttons
    let actionHtml = `<button class="panel-copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('${cardId}-cover').textContent).then(()=>this.textContent='✓ Copied!')">Copy Letter</button>`;
    if (data.sent) {
      actionHtml += `<span class="panel-sent-badge">✓ Application sent to ${data.emailContact}</span>`;
    } else if (data.emailContact) {
      actionHtml += `<span class="panel-err-badge">⚠️ Could not send: ${data.sendError || 'email not configured'}</span>`;
    }
    if (data.applyUrl) {
      actionHtml += `<a class="job-apply-btn" href="${data.applyUrl}" target="_blank" rel="noopener">Apply on site →</a>`;
    }
    actionsEl.innerHTML = actionHtml;
    actionsEl.style.display = 'flex';
  } catch (e) {
    coverEl.style.display = 'block';
    coverEl.textContent = 'Request failed';
  } finally {
    btn.textContent = 'Regenerate';
    btn.disabled = false;
  }
}

async function sendShareEmail(cardId, idx) {
  const job = _jobCache[idx];
  if (!job) return;
  const to = document.getElementById(`${cardId}-shareto`)?.value?.trim();
  if (!to) { document.getElementById(`${cardId}-share-status`).textContent = 'Enter a recipient email'; return; }
  const statusEl = document.getElementById(`${cardId}-share-status`);
  const btn = document.querySelector(`#${cardId}-share .panel-send-btn`);
  btn.textContent = 'Sending…';
  btn.disabled = true;
  try {
    const res = await apiFetch('/api/jobs/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job, to })
    });
    const data = await res.json();
    statusEl.textContent = data.ok ? `✓ Sent to ${to}` : `✗ ${data.error}`;
    statusEl.style.color = data.ok ? '#4ade80' : '#f87171';
  } catch {
    statusEl.textContent = '✗ Send failed';
    statusEl.style.color = '#f87171';
  } finally {
    btn.textContent = 'Send';
    btn.disabled = false;
  }
}

// ── RESUME / PORTFOLIO ──────────────────────────────────
async function loadResumeStatus() {
  try {
    const res  = await apiFetch('/api/resume/profile');
    const data = await res.json();
    if (data.ok && data.profile) renderResumeProfile(data.profile);
  } catch {}
}

function renderResumeProfile(profile) {
  const panel    = document.getElementById('resumePanel');
  const card     = document.getElementById('resumeProfileCard');
  const status   = document.getElementById('resumeStatus');
  const inputs   = document.getElementById('resumeInputs');
  const clearBtn = document.getElementById('resumeClearBtn');

  const skills = (profile.skills || []).slice(0, 10).map(s => `<span class="resume-skill-tag">${s}</span>`).join('');
  card.innerHTML = `
    <div class="resume-profile-name">${profile.name || 'Unknown'}</div>
    <div>${profile.current_role || ''} · ${profile.years_experience || 0} yrs exp · ${profile.preferred_type || 'any'}</div>
    ${profile.salary_expectation ? `<div>Expected: ${profile.salary_expectation}</div>` : ''}
    ${skills ? `<div class="resume-skills-row">${skills}</div>` : ''}
    ${profile.source ? `<div style="margin-top:6px;font-size:10px;opacity:.5">Source: ${profile.source}</div>` : ''}
  `;
  card.style.display     = 'block';
  inputs.style.display   = 'none';
  clearBtn.style.display = '';
  status.textContent = 'Profile loaded — fit scores will use your resume';
  panel.classList.add('loaded');
}

async function clearResumeProfile() {
  await apiFetch('/api/resume/profile', { method: 'DELETE' });
  document.getElementById('resumeProfileCard').style.display = 'none';
  document.getElementById('resumeInputs').style.display      = '';
  document.getElementById('resumeClearBtn').style.display    = 'none';
  document.getElementById('resumeStatus').textContent        = 'No profile loaded — upload PDF or paste URL';
  document.getElementById('resumePanel').classList.remove('loaded');
}

document.getElementById('resumeClearBtn')?.addEventListener('click', clearResumeProfile);

document.getElementById('resumeUrlBtn')?.addEventListener('click', async () => {
  const url = document.getElementById('resumeUrl')?.value?.trim();
  if (!url) return;
  const btn = document.getElementById('resumeUrlBtn');
  btn.textContent = 'Loading…';
  btn.disabled = true;
  try {
    const res  = await apiFetch('/api/resume/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (data.ok) renderResumeProfile(data.profile);
    else document.getElementById('resumeStatus').textContent = `Error: ${data.error}`;
  } catch {
    document.getElementById('resumeStatus').textContent = 'Failed to load URL';
  } finally {
    btn.textContent = 'Load URL';
    btn.disabled = false;
  }
});

document.getElementById('resumeUploadBtn')?.addEventListener('click', () => {
  document.getElementById('resumeFile')?.click();
});

document.getElementById('resumeFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const btn = document.getElementById('resumeUploadBtn');
  btn.textContent = '⏳ Parsing PDF…';
  btn.disabled = true;
  const fd = new FormData();
  fd.append('resume', file);
  try {
    const res  = await apiFetch('/api/resume/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.ok) renderResumeProfile(data.profile);
    else document.getElementById('resumeStatus').textContent = `Error: ${data.error}`;
  } catch {
    document.getElementById('resumeStatus').textContent = 'Upload failed';
  } finally {
    btn.textContent = '📎 Upload PDF Resume';
    btn.disabled = false;
    e.target.value = '';
  }
});

// Load resume status when Jobs tab is opened
document.querySelectorAll('[data-view="jobs"]').forEach(btn => {
  btn.addEventListener('click', () => setTimeout(loadResumeStatus, 60));
});

async function runJobSearch() {
  const query = document.getElementById('jobQuery')?.value?.trim();
  if (!query) return;
  const jobType   = document.getElementById('jobType')?.value   || 'both';
  const platforms = document.getElementById('jobPlatform')?.value || 'both';
  const results   = document.getElementById('jobResults');
  const btn       = document.getElementById('jobSearchBtn');

  results.innerHTML = '<div class="job-loading">🔍 Searching via Firecrawl… this may take 15–30 seconds</div>';
  btn.disabled = true;
  btn.textContent = 'Searching…';

  try {
    const res  = await apiFetch('/api/jobs/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, jobType, platforms, limit: 6 })
    });
    const data = await res.json();
    if (!data.ok) {
      results.innerHTML = `<div class="job-empty">⚠️ ${data.error}</div>`;
    } else if (!data.jobs?.length) {
      results.innerHTML = `<div class="job-empty">No jobs found for "${query}". Try a different query.</div>`;
    } else {
      results.innerHTML = data.jobs.map(renderJobCard).join('');
    }
  } catch {
    results.innerHTML = '<div class="job-empty">Search failed. Check Firecrawl config.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Search';
  }
}

document.getElementById('jobSearchBtn')?.addEventListener('click', runJobSearch);
document.getElementById('jobQuery')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') runJobSearch();
});

// ── INIT ───────────────────────────────────────────────────────
document.getElementById('chatMessages').innerHTML = welcomeHTML();
bindSuggestions();
connectWS();
