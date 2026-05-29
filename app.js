// ═══════════════════════════════════════════
// hermes agent web ui v2
// ═══════════════════════════════════════════
(function() {
'use strict';

// ── Config ──
const DEFAULT_API_URL = 'http://localhost:8642';
const TUNNEL_URL_SOURCES = [
  'https://raw.githubusercontent.com/LantzBrown/hermes-chat/main/tunnel-url.json',
  'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/tunnel-url.txt',
];
const STORAGE_KEY = 'hermes-agent-webui-v2';
const SPINNER_FACES = ['(◕‿◕)', '(◕ᴗ◕✿)', '(◠‿◠)', '(ᵔᴥᵔ)', '(｡◕‿◕｡)', '(✿◠‿◠)', 'ヽ(>∀<)ノ', '(ノ◕ヮ◕)ノ'];
const ACTIVITY_ICONS = ['⚡', '🔧', '🔍', '📝', '🌐', '💻', '📊', '🔗'];

// ── State ──
let config = loadConfig();
let currentSessionId = null;
let messages = [];
let streaming = false;
let abortController = null;
let healthTimer = null;
let spinnerTimer = null;
let activityItems = [];

// ── Config persistence ──
function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      apiUrl: saved.apiUrl || DEFAULT_API_URL,
      apiKey: saved.apiKey || '',
      password: saved.password || '',
      accent: saved.accent || '#d4a039',
    };
  } catch { return { apiUrl: DEFAULT_API_URL, apiKey: '', password: '', accent: '#d4a039' }; }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ── DOM helpers ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── API ──
async function api(path, opts = {}) {
  const url = config.apiUrl + path;
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;
  if (opts.headers) Object.assign(headers, opts.headers);
  const controller = opts._timeout ? new AbortController() : null;
  const timeout = opts._timeout ? setTimeout(() => controller.abort(), opts._timeout) : null;
  try {
    const res = await fetch(url, {
      ...opts,
      headers,
      signal: opts.signal || (controller ? controller.signal : undefined),
    });
    return res;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// ── Toast ──
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2500);
  setTimeout(() => el.remove(), 3000);
}

// ── Health ──
async function checkHealth() {
  const dot = $('#status-dot');
  const text = $('#status-text');
  dot.className = 'status-dot checking';
  text.textContent = 'checking...';

  try {
    const res = await api('/health', { _timeout: 5000 });
    if (res.ok) {
      dot.className = 'status-dot online';
      text.textContent = 'connected';
      return 'online';
    }
  } catch {}

  // Try tunnel URLs
  for (const src of TUNNEL_URL_SOURCES) {
    try {
      let tunnelUrl;
      if (src.endsWith('.json')) {
        const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          tunnelUrl = data.url;
        }
      } else {
        const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
        if (res.ok) tunnelUrl = (await res.text()).trim();
      }
      if (tunnelUrl && tunnelUrl.startsWith('https://')) {
        const orig = config.apiUrl;
        config.apiUrl = tunnelUrl;
        try {
          const test = await api('/health', { _timeout: 8000 });
          if (test.ok) {
            dot.className = 'status-dot tunnel';
            text.textContent = 'tunnel';
            saveConfig();
            toast('connected via tunnel', 'success');
            return 'tunnel';
          }
        } catch {}
        config.apiUrl = orig;
      }
    } catch {}
  }

  dot.className = 'status-dot offline';
  text.textContent = 'offline';
  return 'offline';
}

// ── Lock Screen ──
function initLockScreen() {
  const lockScreen = $('#lock-screen');
  const lockInput = $('#lock-input');
  const lockError = $('#lock-error');

  if (!config.password) {
    unlockScreen();
    return;
  }

  lockInput.focus();
  lockInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (lockInput.value === config.password) {
        unlockScreen();
      } else if (lockInput.value === '') {
        unlockScreen();
      } else {
        lockError.classList.remove('hidden');
        lockInput.value = '';
        setTimeout(() => lockError.classList.add('hidden'), 2000);
      }
    }
  });
}

function unlockScreen() {
  const lockScreen = $('#lock-screen');
  lockScreen.style.animation = 'fadeOut 0.3s ease forwards';
  setTimeout(() => {
    lockScreen.classList.add('hidden');
    $('#app').classList.remove('hidden');
    initApp();
  }, 300);
}

// ── App Init ──
async function initApp() {
  applyAccent(config.accent);
  await checkHealth();
  healthTimer = setInterval(checkHealth, 30000);
  setupEventListeners();
  autoResizeInput();
}

// ── Accent Color ──
function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-dim', color + '26');
  document.documentElement.style.setProperty('--accent-glow', color + '4d');
}

// ── Sessions ──
async function loadSessions() {
  try {
    const res = await api('/sessions');
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function renderSessions() {
  const sessions = await loadSessions();
  const list = $('#session-list');
  list.innerHTML = '';

  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<div class="session-empty">no sessions yet</div>';
    return;
  }

  sessions.forEach(s => {
    const div = document.createElement('div');
    div.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');

    const name = document.createElement('span');
    name.className = 'session-name';
    name.textContent = s.name || s.title || ('session ' + (s.id || '').substring(0, 8));
    name.onclick = () => switchSession(s.id || s.session_id);

    const time = document.createElement('span');
    time.className = 'session-time';
    if (s.created_at || s.updated_at) {
      const d = new Date((s.updated_at || s.created_at) * 1000);
      time.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    const del = document.createElement('button');
    del.className = 'session-del';
    del.textContent = '×';
    del.title = 'Delete session';
    del.onclick = (e) => { e.stopPropagation(); deleteSession(s.id || s.session_id); };

    div.appendChild(name);
    if (time.textContent) div.appendChild(time);
    div.appendChild(del);
    list.appendChild(div);
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
      updateSessionDisplay();
      return currentSessionId;
    }
  } catch (e) { toast('failed to create session', 'error'); }
  return null;
}

async function switchSession(id) {
  if (!id) return;
  currentSessionId = id;
  messages = [];
  $('#session-picker').classList.add('hidden');
  renderMessages();
  updateSessionDisplay();

  try {
    const res = await api('/sessions/' + id + '/messages');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        messages = data.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content :
                   Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : ''
        })).filter(m => m.content);
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
      updateSessionDisplay();
    }
    renderSessions();
    toast('session deleted', 'info');
  } catch { toast('failed to delete session', 'error'); }
}

function updateSessionDisplay() {
  const display = $('#session-id-display');
  const value = $('#session-id-value');
  if (currentSessionId) {
    display.classList.remove('hidden');
    value.textContent = currentSessionId.substring(0, 12) + '...';
  } else {
    display.classList.add('hidden');
  }
}

// ── Render Messages ──
function renderMessages() {
  const container = $('#messages');
  container.innerHTML = '';

  if (messages.length === 0) {
    container.innerHTML = `
      <div id="welcome">
        <pre id="welcome-ascii">
  ┌─────────────────────────────────────┐
  │                                     │
  │   ⚡ hermes agent                   │
  │   ─────────────────                 │
  │   autonomous ai assistant           │
  │                                     │
  │   type a message to begin           │
  │                                     │
  └─────────────────────────────────────┘</pre>
        <div id="welcome-tips">
          <div class="tip"><span class="tip-key">shift+enter</span> new line</div>
          <div class="tip"><span class="tip-key">enter</span> send</div>
          <div class="tip"><span class="tip-key">/help</span> show commands</div>
        </div>
      </div>`;
    return;
  }

  messages.forEach(m => {
    if (m.role === 'tool') return; // Skip tool messages in display
    appendMessageEl(m.role, m.content);
  });
  scrollBottom();
}

function appendMessageEl(role, content) {
  const container = $('#messages');
  // Remove welcome if present
  const welcome = container.querySelector('#welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'msg ' + role;

  const header = document.createElement('div');
  header.className = 'msg-header';
  const label = role === 'user' ? 'you' : role === 'error' ? 'error' : role === 'system' ? 'system' : 'hermes';
  header.textContent = label;

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = renderMarkdown(content || '');

  div.appendChild(header);
  div.appendChild(body);
  container.appendChild(div);
  return body;
}

function createStreamDiv() {
  const container = $('#messages');
  const welcome = container.querySelector('#welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'msg assistant';

  const header = document.createElement('div');
  header.className = 'msg-header';
  header.textContent = 'hermes';

  const body = document.createElement('div');
  body.className = 'msg-body';

  div.appendChild(header);
  div.appendChild(body);
  container.appendChild(div);
  return body;
}

function scrollBottom() {
  const container = $('#messages');
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ── Markdown ──
function renderMarkdown(text) {
  if (!text) return '';
  try {
    const renderer = new marked.Renderer();

    renderer.code = function(obj) {
      const code = typeof obj === 'object' ? obj.text : obj;
      const lang = typeof obj === 'object' ? obj.lang : arguments[1];
      const langLabel = lang || 'code';

      // Skip MEDIA: tags
      if (code && code.trim().startsWith('MEDIA:')) {
        return `<div class="code-block"><div class="code-block-header"><span class="code-lang">media</span></div><pre><code>${escapeHtml(code)}</code></pre></div>`;
      }

      let highlighted;
      try {
        highlighted = lang && hljs.getLanguage(lang)
          ? hljs.highlight(code, { language: lang }).value
          : hljs.highlightAuto(code).value;
      } catch { highlighted = escapeHtml(code); }

      const id = 'cb-' + Math.random().toString(36).slice(2, 8);
      return `<div class="code-block">
        <div class="code-block-header">
          <span class="code-lang">${escapeHtml(langLabel)}</span>
          <button class="copy-btn" data-target="${id}">copy</button>
        </div>
        <pre><code id="${id}" class="hljs">${highlighted}</code></pre>
      </div>`;
    };

    marked.setOptions({ renderer, gfm: true, breaks: true });
    return marked.parse(text);
  } catch { return escapeHtml(text); }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Copy button handler (delegated)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const id = btn.dataset.target;
  const el = document.getElementById(id);
  if (el) {
    navigator.clipboard.writeText(el.textContent).then(() => {
      btn.textContent = 'copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('copied'); }, 1500);
    });
  }
});

// ── Thinking / Activity ──
function showThinking() {
  const el = $('#thinking');
  el.classList.remove('hidden');
  startSpinner();
  scrollBottom();
}

function hideThinking() {
  const el = $('#thinking');
  el.classList.add('hidden');
  stopSpinner();
  hideActivity();
}

function startSpinner() {
  const face = $('#spinner-face');
  let i = 0;
  spinnerTimer = setInterval(() => {
    i = (i + 1) % SPINNER_FACES.length;
    face.textContent = SPINNER_FACES[i];
  }, 2000);
}

function stopSpinner() {
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
}

function showActivity() {
  $('#activity-feed').classList.remove('hidden');
}

function hideActivity() {
  $('#activity-feed').classList.add('hidden');
  $('#activity-feed').innerHTML = '';
  activityItems = [];
}

function addActivityItem(name, status) {
  const feed = $('#activity-feed');
  showActivity();

  // Deduplicate: update existing or add new
  let existing = feed.querySelector(`[data-tool="${CSS.escape(name)}"]`);
  if (existing) {
    existing.querySelector('.activity-status').textContent = status;
    return;
  }

  const div = document.createElement('div');
  div.className = 'activity-item';
  div.dataset.tool = name;
  const icon = ACTIVITY_ICONS[activityItems.length % ACTIVITY_ICONS.length];
  div.innerHTML = `<span class="activity-icon">${icon}</span><span class="activity-name">${escapeHtml(name)}</span><span class="activity-status">${escapeHtml(status)}</span>`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  activityItems.push(name);
}

// ── Send Message ──
async function sendMessage(text) {
  if (!text.trim() || streaming) return;

  // Handle /commands
  const trimmed = text.trim();
  if (trimmed.startsWith('/')) {
    handleSlashCommand(trimmed);
    $('#input').value = '';
    autoResizeInput();
    return;
  }

  $('#input').value = '';
  autoResizeInput();

  if (!currentSessionId) {
    const sid = await createSession();
    if (!sid) { toast('failed to create session', 'error'); return; }
  }

  messages.push({ role: 'user', content: text });
  appendMessageEl('user', text);
  scrollBottom();

  streaming = true;
  $('#btn-send').classList.add('hidden');
  $('#btn-stop').classList.remove('hidden');
  showThinking();

  let fullResponse = '';
  let usedSSE = false;

  // Try SSE streaming via session chat endpoint
  try {
    abortController = new AbortController();

    // Try the session-based streaming endpoint first
    let res;
    try {
      res = await api('/sessions/' + currentSessionId + '/chat/stream', {
        method: 'POST',
        body: JSON.stringify({ message: text, stream: true }),
        signal: abortController.signal,
      });
    } catch {
      // Fallback to /chat endpoint
      res = await api('/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          session_id: currentSessionId,
          stream: true,
        }),
        signal: abortController.signal,
      });
    }

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream') || ct.includes('text/plain') || res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const streamDiv = createStreamDiv();
      hideThinking();
      usedSSE = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const j = JSON.parse(payload);

            // Handle OpenAI-style streaming format
            if (j.choices && j.choices[0]) {
              const delta = j.choices[0].delta;
              if (delta) {
                // Tool call activity
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    if (tc.function && tc.function.name) {
                      addActivityItem(tc.function.name, 'running...');
                    }
                  }
                }
                // Content
                const chunk = delta.content || '';
                if (chunk) {
                  fullResponse += chunk;
                  streamDiv.innerHTML = renderMarkdown(fullResponse);
                  scrollBottom();
                }
              }
            }
            // Handle custom hermes format
            else if (j.type === 'tool_call') {
              addActivityItem(j.name || j.tool || 'tool', 'running...');
            }
            else if (j.type === 'tool_result') {
              const name = j.name || j.tool || 'tool';
              addActivityItem(name, 'done ✓');
            }
            else {
              const chunk = j.content || j.delta || j.text || j.chunk || '';
              if (chunk) {
                fullResponse += chunk;
                streamDiv.innerHTML = renderMarkdown(fullResponse);
                scrollBottom();
              }
            }
          } catch {
            // Raw text chunk
            if (payload && payload !== '[DONE]') {
              fullResponse += payload;
              streamDiv.innerHTML = renderMarkdown(fullResponse);
              scrollBottom();
            }
          }
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      usedSSE = true;
      if (!fullResponse) fullResponse = '*(stopped)*';
    }
  }

  // Fallback: non-streaming
  if (!usedSSE || (!fullResponse && !usedSSE)) {
    try {
      let res;
      try {
        res = await api('/sessions/' + currentSessionId + '/chat', {
          method: 'POST',
          body: JSON.stringify({ message: text }),
        });
      } catch {
        res = await api('/chat', {
          method: 'POST',
          body: JSON.stringify({ message: text, session_id: currentSessionId }),
        });
      }

      if (res.ok) {
        const data = await res.json();
        fullResponse = data.response || data.content || data.message ||
                       (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        if (data.session_id && !currentSessionId) currentSessionId = data.session_id;
      } else {
        fullResponse = 'Error: HTTP ' + res.status;
      }
    } catch (e) {
      fullResponse = 'Error: ' + e.message;
    }

    hideThinking();
    if (fullResponse) {
      appendMessageEl('assistant', fullResponse);
      scrollBottom();
    }
  }

  if (fullResponse) {
    messages.push({ role: 'assistant', content: fullResponse });
  }

  streaming = false;
  abortController = null;
  $('#btn-stop').classList.add('hidden');
  $('#btn-send').classList.remove('hidden');
  hideThinking();
}

function stopStream() {
  if (abortController) abortController.abort();
  streaming = false;
  $('#btn-stop').classList.add('hidden');
  $('#btn-send').classList.remove('hidden');
  hideThinking();
}

// ── Slash Commands ──
function handleSlashCommand(cmd) {
  const parts = cmd.split(' ');
  const command = parts[0].toLowerCase();

  switch (command) {
    case '/help':
      appendMessageEl('system', `**Available Commands:**
- \`/help\` — show this help
- \`/clear\` — clear current chat
- \`/new\` — create new session
- \`/sessions\` — list all sessions
- \`/settings\` — open settings
- \`/url <url>\` — set API URL
- \`/key <key>\` — set API key
- \`/status\` — check connection status`);
      break;
    case '/clear':
      messages = [];
      renderMessages();
      toast('chat cleared', 'info');
      break;
    case '/new':
      createSession();
      toast('new session created', 'success');
      break;
    case '/sessions':
      toggleSessionPicker();
      break;
    case '/settings':
      openSettings();
      break;
    case '/url':
      if (parts[1]) {
        config.apiUrl = parts[1];
        saveConfig();
        checkHealth();
        toast('API URL updated', 'success');
      }
      break;
    case '/key':
      if (parts[1]) {
        config.apiKey = parts[1];
        saveConfig();
        toast('API key updated', 'success');
      }
      break;
    case '/status':
      checkHealth().then(status => {
        appendMessageEl('system', `**Status:** ${status}\n**API URL:** ${config.apiUrl}\n**Session:** ${currentSessionId || 'none'}`);
      });
      break;
    default:
      appendMessageEl('system', `unknown command: ${escapeHtml(command)}. type /help for available commands.`);
  }
  scrollBottom();
}

// ── Input ──
function autoResizeInput() {
  const input = $('#input');
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  $('#char-count').textContent = input.value.length;
}

// ── Settings ──
function openSettings() {
  $('#setting-url').value = config.apiUrl;
  $('#setting-key').value = config.apiKey;
  $('#setting-password').value = config.password;

  // Set active accent button
  $$('.accent-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.accent === config.accent);
  });

  $('#settings-modal').classList.remove('hidden');
}

function closeSettings() {
  $('#settings-modal').classList.add('hidden');
}

function saveSettings() {
  config.apiUrl = $('#setting-url').value.trim() || DEFAULT_API_URL;
  config.apiKey = $('#setting-key').value.trim();
  config.password = $('#setting-password').value.trim();
  saveConfig();
  closeSettings();
  checkHealth();
  toast('settings saved', 'success');
}

// ── Session Picker Toggle ──
function toggleSessionPicker() {
  const picker = $('#session-picker');
  if (picker.classList.contains('hidden')) {
    renderSessions();
    picker.classList.remove('hidden');
  } else {
    picker.classList.add('hidden');
  }
}

// ── Event Listeners ──
function setupEventListeners() {
  // Send
  $('#btn-send').addEventListener('click', () => sendMessage($('#input').value));
  $('#btn-stop').addEventListener('click', stopStream);

  // Input
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage($('#input').value);
    }
  });
  $('#input').addEventListener('input', autoResizeInput);

  // Top bar
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-new').addEventListener('click', async () => {
    await createSession();
    $('#session-picker').classList.add('hidden');
    toast('new session', 'success');
  });
  $('#btn-sessions').addEventListener('click', toggleSessionPicker);
  $('#session-close').addEventListener('click', () => $('#session-picker').classList.add('hidden'));

  // Settings
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-cancel-settings').addEventListener('click', closeSettings);
  $('#btn-close-settings').addEventListener('click', closeSettings);
  $('#settings-modal').addEventListener('click', (e) => {
    if (e.target === $('#settings-modal')) closeSettings();
  });

  // Accent picker
  $$('.accent-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.accent-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      config.accent = btn.dataset.accent;
      applyAccent(config.accent);
      saveConfig();
    });
  });

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    const picker = $('#session-picker');
    if (!picker.contains(e.target) && e.target !== $('#btn-sessions') && !$('#btn-sessions').contains(e.target)) {
      picker.classList.add('hidden');
    }
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape to stop stream or close modals
    if (e.key === 'Escape') {
      if (streaming) { stopStream(); return; }
      if (!$('#settings-modal').classList.contains('hidden')) { closeSettings(); return; }
      if (!$('#session-picker').classList.contains('hidden')) { $('#session-picker').classList.add('hidden'); return; }
    }
    // Ctrl+K or Cmd+K to focus input
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      $('#input').focus();
    }
  });
}

// ── Init ──
initLockScreen();

})();
