// app.js — Hermes Chat UI v6
(function() {
'use strict';

// ── Config ──
const DEFAULT_API_URL = 'http://localhost:8642';
const TUNNEL_URL = 'https://continuing-raleigh-respectively-now.trycloudflare.com';
const TUNNEL_URL_SOURCE = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/tunnel-url.txt';
const DEFAULT_API_KEY = 'bzJg4-OgW2sP13g8G7uAeEAkt7KciUGu6BQUq-_VZcw';
const STORAGE_KEY = 'hermes-chat-config-v9';

// ── Shortcuts ──
const q = (sel) => document.querySelector(sel);
const qAll = (sel) => document.querySelectorAll(sel);

// ── State ──
let config = loadConfig();
let currentSessionId = null;
let messages = [];
let streaming = false;
let abortController = null;
let activityPollTimer = null;
let healthTimer = null;
let currentStreamDiv = null;

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      apiUrl: saved.apiUrl || DEFAULT_API_URL,
      apiKey: saved.apiKey || DEFAULT_API_KEY
    };
  } catch {
    return { apiUrl: DEFAULT_API_URL, apiKey: DEFAULT_API_KEY };
  }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ── DOM refs ──
const dom = {
  messages: q('#messages'),
  welcome: q('#welcome'),
  input: q('#input'),
  btnSend: q('#btn-send'),
  btnStop: q('#btn-stop'),
  btnSettings: q('#btn-settings'),
  btnNew: q('#btn-new'),
  btnSessions: q('#btn-sessions'),
  statusDot: q('#status-dot'),
  thinking: q('#thinking'),
  activityLog: q('#activity-log'),
  sessionPicker: q('#session-picker'),
  sessionList: q('#session-list'),
  settingsModal: q('#settings-modal'),
  settingUrl: q('#setting-url'),
  settingKey: q('#setting-key'),
  btnSaveSettings: q('#btn-save-settings'),
  btnCloseSettings: q('#btn-close-settings')
};

// ── API Helper ──
async function api(path, opts = {}) {
  const url = config.apiUrl + path;
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;
  if (opts.headers) Object.assign(headers, opts.headers);
  return fetch(url, { ...opts, headers });
}

// ── Health Check ──
async function checkHealth() {
  dom.statusDot.className = 'status-dot checking';
  try {
    const res = await api('/health', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      dom.statusDot.className = 'status-dot online';
      return true;
    }
  } catch {}
  dom.statusDot.className = 'status-dot offline';
  return false;
}

async function discoverTunnel() {
  try {
    const res = await fetch(TUNNEL_URL_SOURCE, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const url = (await res.text()).trim();
      if (url && url.startsWith('https://')) {
        // Test it
        try {
          const test = await fetch(url + '/health', { signal: AbortSignal.timeout(5000) });
          if (test.ok) {
            config.apiUrl = url;
            saveConfig();
            return true;
          }
        } catch {}
      }
    }
  } catch {}
  return false;
}

async function healthCheck() {
  if (await checkHealth()) return;
  // Try tunnel
  if (TUNNEL_URL) {
    const orig = config.apiUrl;
    config.apiUrl = TUNNEL_URL;
    if (await checkHealth()) { saveConfig(); return; }
    config.apiUrl = orig;
  }
  // Try GitHub source
  await discoverTunnel();
}

// ── Session Management ──
async function loadSessions() {
  try {
    const res = await api('/sessions');
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function renderSessions() {
  const sessions = await loadSessions();
  dom.sessionList.innerHTML = '';
  if (sessions.length === 0) {
    dom.sessionList.innerHTML = '<div style="padding:10px;color:var(--text-muted)">no sessions</div>';
    return;
  }
  sessions.forEach(s => {
    const div = document.createElement('div');
    div.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = s.name || s.id.substring(0, 8);
    name.style.flex = '1';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    name.onclick = () => switchSession(s.id);
    const del = document.createElement('button');
    del.className = 'del-btn';
    del.textContent = '×';
    del.title = 'Delete';
    del.onclick = (e) => { e.stopPropagation(); deleteSession(s.id); };
    div.appendChild(name);
    div.appendChild(del);
    dom.sessionList.appendChild(div);
  });
}

async function createSession() {
  try {
    const res = await api('/sessions', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      currentSessionId = data.id || data.session_id;
      messages = [];
      renderMessages();
      return currentSessionId;
    }
  } catch {}
  return null;
}

async function switchSession(id) {
  currentSessionId = id;
  messages = [];
  dom.sessionPicker.classList.add('hidden');
  renderMessages();
  // Load history
  try {
    const res = await api('/sessions/' + id + '/messages');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        messages = data.map(m => ({ role: m.role, content: m.content }));
        renderMessages();
      }
    }
  } catch {}
}

async function deleteSession(id) {
  try {
    await api('/sessions/' + id, { method: 'DELETE' });
    if (id === currentSessionId) {
      currentSessionId = null;
      messages = [];
      renderMessages();
    }
    renderSessions();
  } catch {}
}

// ── Render Messages ──
function renderMessages() {
  dom.messages.innerHTML = '';
  if (messages.length === 0) {
    dom.messages.innerHTML = `
      <div id="welcome">
        <div id="welcome-prompt">hermes@agent ~ $</div>
        <div id="welcome-msg">ready. type a message to begin.</div>
      </div>`;
    return;
  }
  messages.forEach(m => appendMessage(m.role, m.content));
  scrollBottom();
}

function appendMessage(role, content) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  const header = document.createElement('div');
  header.className = 'msg-header';
  header.textContent = role === 'user' ? 'you' : role === 'error' ? 'error' : 'hermes';
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = renderMarkdown(content);
  div.appendChild(header);
  div.appendChild(body);
  dom.messages.appendChild(div);
  return body;
}

function createStreamDiv() {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const header = document.createElement('div');
  header.className = 'msg-header';
  header.textContent = 'hermes';
  const body = document.createElement('div');
  body.className = 'msg-body';
  div.appendChild(header);
  div.appendChild(body);
  dom.messages.appendChild(div);
  return body;
}

function scrollBottom() {
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

// ── Markdown Rendering ──
function renderMarkdown(text) {
  if (!text) return '';
  try {
    const renderer = new marked.Renderer();
    renderer.code = function(obj) {
      const code = typeof obj === 'object' ? obj.text : obj;
      const lang = typeof obj === 'object' ? obj.lang : arguments[1];
      const langLabel = lang || 'code';
      let highlighted;
      try {
        highlighted = lang && hljs.getLanguage(lang)
          ? hljs.highlight(code, { language: lang }).value
          : hljs.highlightAuto(code).value;
      } catch { highlighted = escapeHtml(code); }
      const id = 'cb-' + Math.random().toString(36).slice(2, 8);
      return `<div class="code-block">
        <div class="code-block-header"><span>${escapeHtml(langLabel)}</span><button class="copy-btn" onclick="window.copyCode('${id}')">copy</button></div>
        <pre><code id="${id}" class="hljs">${highlighted}</code></pre>
      </div>`;
    };
    marked.setOptions({
      renderer: renderer,
      gfm: true,
      breaks: true
    });
    return marked.parse(text);
  } catch { return escapeHtml(text); }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

window.copyCode = function(id) {
  const el = document.getElementById(id);
  if (el) {
    navigator.clipboard.writeText(el.textContent).then(() => {
      const btn = el.closest('.code-block').querySelector('.copy-btn');
      btn.textContent = 'copied!';
      setTimeout(() => btn.textContent = 'copy', 1500);
    });
  }
};

// ── Thinking / Activity ──
function showThinking() {
  dom.thinking.classList.remove('hidden');
  scrollBottom();
}

function hideThinking() {
  dom.thinking.classList.add('hidden');
}

function showActivity() {
  dom.activityLog.classList.remove('hidden');
}

function hideActivity() {
  dom.activityLog.classList.add('hidden');
  dom.activityLog.innerHTML = '';
}

function addActivityItem(name, status) {
  const div = document.createElement('div');
  div.className = 'activity-item';
  div.innerHTML = `<span class="tool-name">${escapeHtml(name)}</span><span class="tool-status">${escapeHtml(status)}</span>`;
  dom.activityLog.appendChild(div);
  dom.activityLog.scrollTop = dom.activityLog.scrollHeight;
}

async function pollActivity() {
  if (!currentSessionId) return;
  try {
    const res = await api('/sessions/' + currentSessionId + '/activity');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        showActivity();
        dom.activityLog.innerHTML = '';
        data.forEach(a => addActivityItem(a.tool || a.name || 'tool', a.status || 'running'));
      }
    }
  } catch {}
}

// ── Send Message ──
async function sendMessage(text) {
  if (!text.trim() || streaming) return;
  dom.input.value = '';
  autoResize();

  if (!currentSessionId) {
    await createSession();
  }

  messages.push({ role: 'user', content: text });
  appendMessage('user', text);
  scrollBottom();

  streaming = true;
  dom.btnSend.classList.add('hidden');
  dom.btnStop.classList.remove('hidden');
  showThinking();

  let fullResponse = '';
  let used = false;

  // Try SSE streaming first
  try {
    abortController = new AbortController();
    const res = await api('/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: text,
        session_id: currentSessionId,
        stream: true
      }),
      signal: abortController.signal
    });

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream') || ct.includes('text/plain')) {
      // SSE streaming
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      currentStreamDiv = createStreamDiv();
      hideThinking();
      used = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6);
            if (payload === '[DONE]') break;
            try {
              const j = JSON.parse(payload);
              const chunk = j.content || j.delta || j.text || '';
              if (chunk) {
                fullResponse += chunk;
                currentStreamDiv.innerHTML = renderMarkdown(fullResponse);
                scrollBottom();
              }
            } catch {
              fullResponse += payload;
              currentStreamDiv.innerHTML = renderMarkdown(fullResponse);
              scrollBottom();
            }
          }
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      used = true;
    }
  }

  // Fallback: non-streaming
  if (!used) {
    // Start activity polling
    activityPollTimer = setInterval(pollActivity, 2000);

    try {
      const res = await api('/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          session_id: currentSessionId,
          stream: false
        })
      });
      if (res.ok) {
        const data = await res.json();
        fullResponse = data.response || data.content || data.message || '';
        if (data.session_id && !currentSessionId) currentSessionId = data.session_id;
      } else {
        fullResponse = 'Error: HTTP ' + res.status;
      }
    } catch (e) {
      fullResponse = 'Error: ' + e.message;
    }

    clearInterval(activityPollTimer);
    activityPollTimer = null;
    hideActivity();
    hideThinking();

    if (fullResponse) {
      appendMessage('assistant', fullResponse);
      scrollBottom();
    }
  }

  if (fullResponse) {
    messages.push({ role: 'assistant', content: fullResponse });
  }

  streaming = false;
  abortController = null;
  currentStreamDiv = null;
  dom.btnStop.classList.add('hidden');
  dom.btnSend.classList.remove('hidden');
  hideThinking();
  hideActivity();
}

function stopStream() {
  if (abortController) abortController.abort();
  streaming = false;
  dom.btnStop.classList.add('hidden');
  dom.btnSend.classList.remove('hidden');
  hideThinking();
}

// ── Input ──
function autoResize() {
  dom.input.style.height = 'auto';
  dom.input.style.height = Math.min(dom.input.scrollHeight, 200) + 'px';
}

// ── Settings ──
function openSettings() {
  dom.settingUrl.value = config.apiUrl;
  dom.settingKey.value = config.apiKey;
  dom.settingsModal.classList.remove('hidden');
}

function closeSettings() {
  dom.settingsModal.classList.add('hidden');
}

function saveSettings() {
  config.apiUrl = dom.settingUrl.value.trim() || DEFAULT_API_URL;
  config.apiKey = dom.settingKey.value.trim();
  saveConfig();
  closeSettings();
  healthCheck();
}

// ── Event Listeners ──
dom.btnSend.addEventListener('click', () => sendMessage(dom.input.value));
dom.btnStop.addEventListener('click', stopStream);
dom.btnSettings.addEventListener('click', openSettings);
dom.btnSaveSettings.addEventListener('click', saveSettings);
dom.btnCloseSettings.addEventListener('click', closeSettings);

dom.btnNew.addEventListener('click', async () => {
  await createSession();
  dom.sessionPicker.classList.add('hidden');
});

dom.btnSessions.addEventListener('click', async () => {
  if (dom.sessionPicker.classList.contains('hidden')) {
    await renderSessions();
    dom.sessionPicker.classList.remove('hidden');
  } else {
    dom.sessionPicker.classList.add('hidden');
  }
});

dom.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(dom.input.value);
  }
});

dom.input.addEventListener('input', autoResize);

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!dom.sessionPicker.contains(e.target) && e.target !== dom.btnSessions) {
    dom.sessionPicker.classList.add('hidden');
  }
});

dom.settingsModal.addEventListener('click', (e) => {
  if (e.target === dom.settingsModal) closeSettings();
});

// ── Init ──
healthCheck();
healthTimer = setInterval(healthCheck, 30000);

})();
