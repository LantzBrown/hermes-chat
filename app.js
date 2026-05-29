// Hermes Chat UI v10 (terminal-style)
(() => {
    'use strict';

    const DEFAULT_API_URL = 'http://localhost:8642';
    const TUNNEL_URL = 'https://continuing-raleigh-respectively-now.trycloudflare.com';
    const TUNNEL_URL_SOURCE = 'https://raw.githubusercontent.com/LantzBrown/hermes-chat/main/tunnel-url.json';
    const DEFAULT_API_KEY='bzJg4-OgW2sP13g8G7uAeEAkt7KciUGu6BQUq-_VZcw';
    const STORAGE_KEY = 'hermes-chat-config-v8';

    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

    let config = loadConfig();
    let sessions = {};
    let activeSessionId = null;
    let isStreaming = false;
    let abortController = null;
    let thinkingEl = null;
    let activityEl = null;

    const $ = s => document.querySelector(s);
    const welcomeScreen = $('#welcomeScreen');
    const messagesEl = $('#messages');
    const messageInput = $('#messageInput');
    const sendBtn = $('#sendBtn');
    const stopBtn = $('#stopBtn');
    const sessionPicker = $('#sessionPicker');
    const sessionList = $('#sessionList');

    marked.setOptions({
        highlight: (code, lang) => {
            if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
            return hljs.highlightAuto(code).value;
        },
        breaks: true, gfm: true,
    });

    // ── Lock Screen ──
    const LOCK_PASSWORD='Lantz_040405';
    const lockScreen = document.getElementById('lockScreen');
    const lockForm = document.getElementById('lockForm');
    const lockPassword = document.getElementById('lockPassword');
    const lockError = document.getElementById('lockError');
    const mainApp = document.getElementById('mainApp');

    function unlockApp() {
        lockScreen.classList.add('hidden');
        mainApp.style.display = '';
        messageInput.focus();
    }
    if (sessionStorage.getItem('hermes-unlocked') === 'true') unlockApp();
    lockForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (lockPassword.value === LOCK_PASSWORD) {
            lockError.textContent = ''; sessionStorage.setItem('hermes-unlocked', 'true'); unlockApp();
        } else {
            lockError.textContent = 'access denied.'; lockPassword.value = ''; lockPassword.focus();
        }
    });

    // ── Init ──
    // Lock screen
    var lockScreen = document.getElementById('lockScreen');
    var lockForm = document.getElementById('lockForm');
    var lockPwd = document.getElementById('lockPassword');
    var lockErr = document.getElementById('lockError');
    var mainApp = document.getElementById('mainApp');
    function unlockApp() { lockScreen.classList.add('hidden'); mainApp.style.display = ''; messageInput.focus(); }
    if (sessionStorage.getItem('hermes-unlocked') === 'true') unlockApp();
    lockForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (lockPwd.value === 'Lantz_040405') { sessionStorage.setItem('hermes-unlocked', 'true'); unlockApp(); }
        else { lockErr.textContent = 'access denied.'; lockPwd.value = ''; lockPwd.focus(); }
    });

    // Nav tabs
    document.querySelectorAll('.nav-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            var name = tab.dataset.tab;
            document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === name); });
            document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.toggle('active', p.id === 'tab' + name.charAt(0).toUpperCase() + name.slice(1)); });
            if (name === 'cron') loadCronJobs();
            if (name === 'overview') loadOverview();
            var ia = document.querySelector('.input-area');
            if (ia) ia.style.display = name === 'chat' ? '' : 'none';
        });
    });

    // Command palette
    var COMMANDS = [
        { name: '/new', desc: 'new conversation', action: 'newChat' },
        { name: '/sessions', desc: 'show sessions', action: 'showSessionsCmd' },
        { name: '/settings', desc: 'settings', action: 'openSettingsCmd' },
        { name: '/stop', desc: 'stop', action: 'stopGen' },
        { name: '/help', desc: 'help', action: 'showHelp' }
    ];
    var cmdSel = -1;
    var cmdPalette = q('#cmdPalette');
    function onInput() { autoResize(); var v = messageInput.value; if (v === '/') openCmdPalette(''); else if (v.startsWith('/')) openCmdPalette(v); else closeCmdPalette(); }
    function openCmdPalette(query) {
        var qq = query.replace(/^\//, '').toLowerCase();
        var filt = COMMANDS.filter(function(c) { return c.name.includes('/' + qq) || c.desc.includes(qq); });
        if (!filt.length) { closeCmdPalette(); return; }
        cmdPalette.innerHTML = '<div class="cmd-palette-header">commands</div>' + filt.map(function(c, i) { return '<div class="cmd-item' + (i === 0 ? ' selected' : '') + '" data-action="' + c.action + '\">' + c.name + ' <span class="cmd-item-desc">' + c.desc + '</span></div>'; }).join('');
        cmdPalette.classList.add('active'); cmdSel = 0;
        cmdPalette.querySelectorAll('.cmd-item').forEach(function(el) { el.addEventListener('click', function() { closeCmdPalette(); messageInput.value = ''; autoResize(); if (typeof window[el.dataset.action] === 'function') window[el.dataset.action](); }); });
    }
    function closeCmdPalette() { cmdPalette.classList.remove('active'); cmdSel = -1; }
    function navigateCmd(dir) { var items = cmdPalette.querySelectorAll('.cmd-item'); if (!items.length) return; items[cmdSel] && items[cmdSel].classList.remove('selected'); cmdSel = (cmdSel + dir + items.length) % items.length; items[cmdSel] && items[cmdSel].classList.add('selected'); }
    function selectCmd() { var items = cmdPalette.querySelectorAll('.cmd-item'); var el = items[cmdSel]; if (el) { closeCmdPalette(); messageInput.value = ''; autoResize(); if (typeof window[el.dataset.action] === 'function') window[el.dataset.action](); } }
    window.newChat = newChat; window.showSessionsCmd = toggleSessions; window.openSettingsCmd = openSettings; window.stopGen = stopGeneration;
    window.showHelp = function() { messageInput.value = ''; closeCmdPalette(); appendMessage('assistant', 'commands: /new, /sessions, /settings, /stop, /help', false); };

    checkHealth();
    loadSessionsFromServer();
    messageInput.focus();
    setInterval(checkHealth, 30000);

    // ── Nav Tabs ──
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const name = tab.dataset.tab;
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab' + name.charAt(0).toUpperCase() + name.slice(1)));
            // Show/hide input area based on tab
            const inputArea = document.querySelector('.input-area');
            if (inputArea) inputArea.style.display = name === 'chat' ? '' : 'none';
            // Hide session picker on non-chat tabs
            if (name !== 'chat') sessionPicker.classList.remove('open');
            if (name === 'cron') loadCronJobs();
            if (name === 'overview') loadOverview();
            if (name === 'remote') { rdActive = true; if (!rdConnected && rdConfig.wsUrl) rdConnect(); rdBindEvents(); }
            else { rdActive = false; if (rdWs) { rdWs.close(); rdWs = null; } }
        });
    });

    // ── Events ──
    messageInput.addEventListener('input', onInput);
    messageInput.addEventListener('keydown', handleKeydown);
    sendBtn.addEventListener('click', sendMessage);
    stopBtn.addEventListener('click', stopGeneration);
    $('#newChatBtn').addEventListener('click', newChat);
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#closeSettingsBtn').addEventListener('click', closeSettings);
    $('#cancelSettingsBtn').addEventListener('click', closeSettings);
    $('#saveSettingsBtn').addEventListener('click', saveSettings);
    $('#sessionsBtn').addEventListener('click', toggleSessions);
    $('#closeSessions').addEventListener('click', () => sessionPicker.classList.remove('open'));
    $('#settingsModal').addEventListener('click', e => { if (e.target === $('#settingsModal')) closeSettings(); });
    document.addEventListener('click', e => {
        if (!sessionPicker.contains(e.target) && e.target !== $('#sessionsBtn')) sessionPicker.classList.remove('open');
    });

    // ── Input Handling ──
    const cmdPalette = $('#cmdPalette');
    let cmdSelected = -1;

    const COMMANDS = [
        { name: '/new', desc: 'start a new conversation', icon: '+', action: 'newChat' },
        { name: '/clear', desc: 'clear screen and start fresh', icon: '~', action: 'newChat' },
        { name: '/sessions', desc: 'show all conversations', icon: '#', action: 'toggleSessions' },
        { name: '/settings', desc: 'open settings', icon: '*', action: 'openSettings' },
        { name: '/stop', desc: 'stop the current response', icon: '!', action: 'stopGeneration' },
        { name: '/help', desc: 'show available commands', icon: '?', action: 'showHelp' },
    ];

    function onInput() {
        autoResize();
        const val = messageInput.value;
        if (val === '/') openCmdPalette('');
        else if (val.startsWith('/')) openCmdPalette(val);
        else closeCmdPalette();
    }

    function handleKeydown(e) {
        if (cmdPalette && cmdPalette.classList.contains('active')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); navigateCmd(1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); navigateCmd(-1); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectCmd(); return; }
            if (e.key === 'Escape') { closeCmdPalette(); return; }
        }
        if (cmdPalette.classList.contains('active')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); navigateCmd(1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); navigateCmd(-1); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectCmd(); return; }
            if (e.key === 'Escape') { closeCmdPalette(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isStreaming && messageInput.value.trim()) sendMessage();
        }
    }

    function openCmdPalette(query) {
        const q = query.replace(/^\//, '').toLowerCase();
        const filtered = COMMANDS.filter(c => c.name.toLowerCase().includes('/' + q) || c.desc.toLowerCase().includes(q));
        if (filtered.length === 0) { closeCmdPalette(); return; }
        cmdPalette.innerHTML = '<div class="cmd-palette-header">commands</div>' +
            filtered.map((c, i) =>
                '<div class="cmd-item' + (i === 0 ? ' selected' : '') + '" data-action="' + c.action + '">' +
                '<span class="cmd-item-icon">' + c.icon + '</span>' +
                '<div class="cmd-item-info"><div class="cmd-item-name">' + c.name + '</div>' +
                '<div class="cmd-item-desc">' + c.desc + '</div></div></div>'
            ).join('');
        cmdPalette.classList.add('active');
        cmdSelected = 0;
        cmdPalette.querySelectorAll('.cmd-item').forEach(el => {
            el.addEventListener('click', () => {
                const action = el.dataset.action; closeCmdPalette(); messageInput.value = ''; autoResize();
                if (typeof window[action] === 'function') window[action]();
            });
        });
    }

    function closeCmdPalette() { cmdPalette.classList.remove('active'); cmdSelected = -1; }

    function navigateCmd(dir) {
        const items = cmdPalette.querySelectorAll('.cmd-item');
        if (items.length === 0) return;
        items[cmdSelected]?.classList.remove('selected');
        cmdSelected = (cmdSelected + dir + items.length) % items.length;
        items[cmdSelected]?.classList.add('selected');
        items[cmdSelected]?.scrollIntoView({ block: 'nearest' });
    }

    function selectCmd() {
        const items = cmdPalette.querySelectorAll('.cmd-item');
        const el = items[cmdSelected];
        if (el) {
            const action = el.dataset.action; closeCmdPalette(); messageInput.value = ''; autoResize();
            if (typeof window[action] === 'function') window[action]();
        }
    }

    // Expose for command palette
    window.newChat = newChat;
    window.openSettings = openSettings;
    window.stopGeneration = stopGeneration;
    window.toggleSessions = toggleSessions;
    window.showHelp = () => {
        messageInput.value = ''; closeCmdPalette();
        appendMessage('assistant',
            'available commands:\n\n' +
            COMMANDS.map(c => '  ' + c.name + '  --  ' + c.desc).join('\n') +
            '\n\ntype anything to chat.', false);
    };

    // ── Config ──
    function loadConfig() {
        try {
            const s = localStorage.getItem(STORAGE_KEY);
            if (s) {
                const p = JSON.parse(s);
                if (!p.apiKey) p.apiKey = DEFAULT_API_KEY;
                if (!p.apiUrl) p.apiUrl = isLocal ? DEFAULT_API_URL : TUNNEL_URL;
                return p;
            }
        } catch {}
        return { apiUrl: isLocal ? DEFAULT_API_URL : TUNNEL_URL, apiKey: DEFAULT_API_KEY };
    }

    function saveConfig() { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); }
    function getApiUrl() { return (config.apiUrl || (isLocal ? DEFAULT_API_URL : TUNNEL_URL)).replace(/\/+$/, ''); }

    async function api(path, opts = {}) {
        const headers = { 'Content-Type': 'application/json', ...opts.headers };
        if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;
        return fetch(getApiUrl() + path, { ...opts, headers });
    }

    // ── Dynamic Tunnel URL Discovery ──
    let lastTunnelCheck = 0;
    async function discoverTunnelUrl() {
        if (isLocal) return;
        const now = Date.now();
        if (now - lastTunnelCheck < 15000) return;
        lastTunnelCheck = now;
        try {
            const resp = await fetch(TUNNEL_URL_SOURCE + '?t=' + now, { cache: 'no-store' });
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.url && data.url !== config.apiUrl && data.url.startsWith('https://')) {
                config.apiUrl = data.url; saveConfig();
            }
        } catch {}
    }
    if (!isLocal) discoverTunnelUrl();

    // ── Health Check ──
    function checkHealth() {
        const dot = $('#statusDot');
        const txt = $('#statusText');
        api('/health').then(r => {
            if (r.ok) { dot.className = 'status-dot connected'; txt.textContent = 'connected'; }
            else { dot.className = 'status-dot error'; txt.textContent = 'error'; if (!isLocal) discoverTunnelUrl(); }
        }).catch(() => {
            dot.className = 'status-dot error'; txt.textContent = 'offline'; if (!isLocal) discoverTunnelUrl();
        });
    }

    // ── Server Sessions ──
    async function loadSessionsFromServer() {
        try {
            const r = await api('/api/sessions');
            if (!r.ok) throw new Error(r.status);
            const d = await r.json();
            sessions = {};
            for (const s of (d.data || [])) {
                if (!s.id) continue;
                sessions[s.id] = { id: s.id, title: s.title || 'Untitled', messages: [],
                    createdAt: (s.started_at || 0) * 1000, updatedAt: (s.last_active || s.started_at || 0) * 1000 };
            }
            renderSessionList();
        } catch { renderSessionList(); }
    }

    async function loadSessionMessages(id) {
        try {
            const r = await api('/api/sessions/' + id + '/messages');
            if (!r.ok) throw new Error(r.status);
            const d = await r.json();
            sessions[id].messages = (d.data || []).filter(m => m.content && (m.role === 'user' || m.role === 'assistant')).map(m => ({ role: m.role, content: m.content }));
            return sessions[id].messages;
        } catch { return sessions[id]?.messages || []; }
    }

    async function createServerSession(title) {
        try {
            let r = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ title, source: 'web' }) });
            let d = await r.json();
            if (!r.ok && d.error?.code === 'invalid_title') {
                r = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ title: title + ' ' + Date.now(), source: 'web' }) });
                d = await r.json();
            }
            return d.session?.id || d.id || 'local_' + Date.now();
        } catch { return 'local_' + Date.now(); }
    }

    async function deleteSession(id) {
        try { await api('/api/sessions/' + id, { method: 'DELETE' }); } catch {}
        delete sessions[id]; if (activeSessionId === id) newChat(); else renderSessionList();
    }

    function toggleSessions() { sessionPicker.classList.toggle('open'); if (sessionPicker.classList.contains('open')) renderSessionList(); }

    function renderSessionList() {
        const sorted = Object.values(sessions).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
        if (sorted.length === 0) { sessionList.innerHTML = '<div class="session-empty">no conversations yet</div>'; return; }
        sessionList.innerHTML = sorted.map(s => {
            const d = new Date(s.updatedAt || s.createdAt);
            const t = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return '<div class="session-item' + (s.id === activeSessionId ? ' active' : '') + '" data-id="' + s.id + '">' +
                '<span class="session-item-title">' + esc(s.title) + '</span>' +
                '<span class="session-item-time">' + t + '</span>' +
                '<button class="session-item-del" data-id="' + s.id + '">&times;</button></div>';
        }).join('');
        sessionList.querySelectorAll('.session-item').forEach(el => {
            el.addEventListener('click', e => { if (!e.target.closest('.session-item-del')) switchToSession(el.dataset.id); });
        });
        sessionList.querySelectorAll('.session-item-del').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); deleteSession(btn.dataset.id); });
        });
    }

    async function switchToSession(id) {
        activeSessionId = id; const s = sessions[id]; if (!s) return;
        welcomeScreen.style.display = 'none'; messagesEl.classList.add('active'); messagesEl.innerHTML = '';
        if (s.messages.length === 0) await loadSessionMessages(id);
        s.messages.forEach(m => appendMessage(m.role, m.content, false));
        renderSessionList(); scrollToBottom(); messageInput.focus(); sessionPicker.classList.remove('open');
    }

    // ── UI Functions ──
    function autoResize() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
        sendBtn.disabled = !messageInput.value.trim() || isStreaming;
    }

    function newChat() {
        activeSessionId = null; messagesEl.innerHTML = ''; messagesEl.classList.remove('active');
        welcomeScreen.style.display = ''; renderSessionList(); messageInput.value = ''; autoResize(); messageInput.focus();
    }

    // ── Messages ──
    function appendMessage(role, content, streaming) {
        const div = document.createElement('div');
        div.className = 'msg ' + role;
        if (role === 'user') {
            div.textContent = content;
        } else if (role === 'error') {
            div.textContent = content;
        } else {
            div.innerHTML = streaming ? '' : renderMd(content);
        }
        messagesEl.appendChild(div);
        scrollToBottom();
        if (!streaming && content && role !== 'user') {
            div.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
            addCodeCopyButtons(div);
        }
        return { messageEl: div, bodyEl: div };
    }

    function renderMd(t) { if (!t) return ''; try { return marked.parse(t); } catch { return esc(t); } }

    function addCodeCopyButtons(container) {
        container.querySelectorAll('pre').forEach(pre => {
            if (pre.querySelector('.code-header')) return;
            const code = pre.querySelector('code'); const lang = code?.className?.replace('language-', '') || '';
            const h = document.createElement('div'); h.className = 'code-header';
            h.innerHTML = '<span>' + (lang || 'code') + '</span><button class="copy-btn">copy</button>';
            h.querySelector('.copy-btn').addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(code.textContent); h.querySelector('.copy-btn').textContent = 'copied!'; setTimeout(() => h.querySelector('.copy-btn').textContent = 'copy', 2000); } catch {}
            });
            pre.insertBefore(h, code);
        });
    }

    function scrollToBottom() { requestAnimationFrame(() => { const panels = document.querySelector('.panels'); if (panels) panels.scrollTop = panels.scrollHeight; }); }
    function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    // ── Settings ──
    function openSettings() {
        $('#apiUrl').value = config.apiUrl || '';
        $('#apiKey').value = config.apiKey || '';
        $('#sessionId').value = config.sessionId || '';
        $('#remoteWsUrl').value = rdConfig.wsUrl || '';
        $('#settingsModal').classList.add('active');
        closeCmdPalette();
    }
    function closeSettings() { $('#settingsModal').classList.remove('active'); }
    function saveSettings() {
        config.apiUrl = $('#apiUrl').value.replace(/\/+$/, '') || (isLocal ? DEFAULT_API_URL : TUNNEL_URL);
        config.apiKey = $('#apiKey').value.trim() || DEFAULT_API_KEY;
        config.sessionId = $('#sessionId').value.trim();
        const newRdUrl = $('#remoteWsUrl').value.trim();
        if (newRdUrl !== rdConfig.wsUrl) {
            rdConfig.wsUrl = newRdUrl;
            localStorage.setItem(RD_STORAGE_KEY, JSON.stringify(rdConfig));
            if ($('#remoteUrlInput')) $('#remoteUrlInput').value = newRdUrl;
        }
        saveConfig(); closeSettings(); checkHealth(); loadSessionsFromServer();
    }

    // ── Streaming ──
    async function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || isStreaming) return;

        if (!activeSessionId) {
            const title = text.slice(0, 60) + (text.length > 60 ? '...' : '');
            activeSessionId = await createServerSession(title);
            sessions[activeSessionId] = { id: activeSessionId, title, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
            welcomeScreen.style.display = 'none'; messagesEl.classList.add('active');
        }

        const session = sessions[activeSessionId];
        if (session.messages.length === 0) session.title = text.slice(0, 60) + (text.length > 60 ? '...' : '');
        session.messages.push({ role: 'user', content: text }); session.updatedAt = Date.now();
        renderSessionList(); appendMessage('user', text, false);
        messageInput.value = ''; autoResize(); showStreamingUI(true);

        try {
            abortController = new AbortController();
            let fullContent = ''; let bodyEl; let activityStarted = false; let streamingOk = false;

            // Try streaming first
            try {
                const resp = await api('/api/sessions/' + activeSessionId + '/chat/stream', {
                    method: 'POST', body: JSON.stringify({ message: text, stream: true }), signal: abortController.signal });
                if (resp.ok) {
                    streamingOk = true; removeThinking();
                    const msg = appendMessage('assistant', '', true); bodyEl = msg.bodyEl;
                    const reader = resp.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
                    while (true) {
                        const { done, value } = await reader.read(); if (done) break;
                        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || '';
                        for (const line of lines) {
                            const trimmed = line.trim(); if (!trimmed || !trimmed.startsWith('data:')) continue;
                            const data = trimmed.slice(5).trim(); if (data === '[DONE]') continue;
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.type === 'tool_call' || parsed.tool_calls) {
                                    const toolName = parsed.name || parsed.tool_calls?.[0]?.function?.name || 'tool';
                                    if (!activityStarted) { showActivityLog(); activityStarted = true; }
                                    addActivityItem('\u25b8', 'calling ' + toolName); updateThinkingLabel('calling ' + toolName + '...');
                                }
                                if (parsed.type === 'tool_result') {
                                    const toolName = parsed.name || 'tool';
                                    if (!activityStarted) { showActivityLog(); activityStarted = true; }
                                    addActivityItem('\u2713', toolName + ' done'); updateThinkingLabel('processing results...');
                                }
                                if (parsed.type === 'thinking' || parsed.type === 'reasoning') updateThinkingLabel('thinking...');
                                const delta = parsed.choices?.[0]?.delta;
                                if (delta?.content) { fullContent += delta.content; bodyEl.innerHTML = renderMd(fullContent); }
                                if (parsed.type === 'content' && parsed.content) { fullContent += parsed.content; bodyEl.innerHTML = renderMd(fullContent); }
                                if (parsed.type === 'text' && parsed.text) { fullContent += parsed.text; bodyEl.innerHTML = renderMd(fullContent); }
                                if (parsed.message?.content && !fullContent) { fullContent = parsed.message.content; bodyEl.innerHTML = renderMd(fullContent); }
                            } catch {}
                        }
                        scrollToBottom();
                    }
                }
            } catch (streamErr) { if (streamingOk) throw streamErr; }

            // Non-streaming fallback
            if (!fullContent) {
                removeThinking(); showThinking('thinking...');
                let pollCount = 0; const seenToolCalls = new Set();
                const activityLabels = ['thinking...', 'working...', 'processing...', 'still working...', 'almost there...'];
                const pollInterval = setInterval(async () => {
                    pollCount++;
                    try {
                        const msgResp = await api('/api/sessions/' + activeSessionId + '/messages');
                        if (msgResp.ok) {
                            const msgData = await msgResp.json();
                            for (const m of (msgData.data || [])) {
                                if (m.role === 'assistant' && m.tool_calls) {
                                    for (const tc of m.tool_calls) {
                                        const name = tc.function?.name || tc.name || 'tool';
                                        const key = name + '_' + (tc.id || '');
                                        if (!seenToolCalls.has(key)) { seenToolCalls.add(key); if (!activityStarted) { showActivityLog(); activityStarted = true; } addActivityItem('\u25b8', 'running ' + name); updateThinkingLabel('running ' + name + '...'); }
                                    }
                                }
                                if (m.role === 'tool' && m.name) {
                                    const key = 'result_' + m.name + '_' + (m.tool_call_id || '');
                                    if (!seenToolCalls.has(key)) { seenToolCalls.add(key); if (!activityStarted) { showActivityLog(); activityStarted = true; } addActivityItem('\u2713', m.name + ' done'); }
                                }
                            }
                            if (seenToolCalls.size === 0 && pollCount > 1) updateThinkingLabel(activityLabels[Math.min(pollCount - 1, activityLabels.length - 1)]);
                        }
                    } catch {}
                    scrollToBottom();
                }, 2500);

                try {
                    const resp = await api('/api/sessions/' + activeSessionId + '/chat', { method: 'POST', body: JSON.stringify({ message: text }), signal: abortController.signal });
                    clearInterval(pollInterval);
                    if (!resp.ok) { const errText = await resp.text(); let errMsg; try { errMsg = JSON.parse(errText).error?.message || errText; } catch { errMsg = errText; } throw new Error(resp.status + ': ' + errMsg); }
                    const fd = await resp.json(); fullContent = fd.message?.content || fd.content || '';
                } catch (pollErr) { clearInterval(pollInterval); throw pollErr; }
                if (!streamingOk) { const msg = appendMessage('assistant', '', true); bodyEl = msg.bodyEl; }
                bodyEl.innerHTML = renderMd(fullContent);
            }

            if (fullContent) { session.messages.push({ role: 'assistant', content: fullContent }); session.updatedAt = Date.now(); }
            bodyEl.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
            addCodeCopyButtons(bodyEl); scrollToBottom();

        } catch (err) {
            removeThinking();
            if (err.name === 'AbortError') appendMessage('assistant', '*stopped*', false);
            else { appendMessage('error', 'failed: ' + err.message, false); session.messages.pop(); }
        } finally { showStreamingUI(false); autoResize(); messageInput.focus(); }
    }

    function stopGeneration() { if (abortController) abortController.abort(); }

    function showStreamingUI(streaming) {
        isStreaming = streaming; sendBtn.style.display = streaming ? 'none' : 'flex';
        stopBtn.style.display = streaming ? 'flex' : 'none'; sendBtn.disabled = true;
        messageInput.disabled = false; messageInput.placeholder = streaming ? 'hermes is working...' : '';
        if (streaming) showThinking();
    }

    // ── Thinking / Activity (terminal style) ──
    function showThinking(label) {
        removeThinking();
        thinkingEl = document.createElement('div');
        thinkingEl.className = 'thinking';
        thinkingEl.textContent = label || 'thinking...';
        messagesEl.appendChild(thinkingEl); scrollToBottom();
    }
    function updateThinkingLabel(label) { if (thinkingEl) thinkingEl.textContent = label; }
    function removeThinking() { if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; } if (activityEl) { activityEl.remove(); activityEl = null; } }

    function showActivityLog() {
        if (activityEl) return;
        activityEl = document.createElement('div'); activityEl.className = 'activity-log';
        if (thinkingEl) thinkingEl.after(activityEl); else messagesEl.appendChild(activityEl);
    }
    function addActivityItem(icon, text) {
        if (!activityEl) showActivityLog();
        const item = document.createElement('div'); item.className = 'activity-item';
        const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        item.innerHTML = '<span>' + icon + ' ' + esc(text) + '</span><span class="activity-time">' + time + '</span>';
        activityEl.appendChild(item); scrollToBottom();
    }

    // ── Cron Jobs ──
    async function loadCronJobs() {
        const el = $('#cronContent'); const label = $('#cronRefreshLabel');
        try {
            const r = await api('/api/jobs'); if (!r.ok) throw new Error(r.status);
            const d = await r.json(); const jobs = d.jobs || [];
            label.textContent = 'updated ' + new Date().toLocaleTimeString();
            if (jobs.length === 0) { el.innerHTML = '<div class="empty-state">no cron jobs configured</div>'; return; }
            el.innerHTML = jobs.map(j => {
                const enabled = j.enabled !== false;
                const statusBadge = enabled ? '<span class="badge badge-green">enabled</span>' : '<span class="badge badge-muted">disabled</span>';
                const lastRun = j.last_run_at ? new Date(j.last_run_at * 1000).toLocaleString() : 'never';
                const lastStatus = j.last_run_status === 'success' ? '<span class="badge badge-green">success</span>'
                    : j.last_run_status === 'error' ? '<span class="badge badge-red">error</span>'
                    : j.last_run_status ? '<span class="badge badge-orange">' + esc(j.last_run_status) + '</span>' : '<span class="badge badge-muted">\u2014</span>';
                return '<div class="info-card"><div class="card-title">' + esc(j.name || 'unnamed') + '</div><div class="card-meta">' +
                    '<span class="meta-item"><span class="meta-label">schedule:</span> ' + esc(j.schedule || '\u2014') + '</span>' +
                    '<span class="meta-item">' + statusBadge + '</span>' +
                    '<span class="meta-item"><span class="meta-label">last run:</span> ' + lastRun + '</span>' +
                    '<span class="meta-item"><span class="meta-label">status:</span> ' + lastStatus + '</span>' +
                    '</div></div>';
            }).join('');
        } catch (err) { label.textContent = ''; el.innerHTML = '<div class="empty-state">failed to load: ' + esc(err.message) + '</div>'; }
    }

    // ── Overview ──
    async function loadOverview() {
        const label = $('#overviewRefreshLabel');
        try {
            const r = await api('/api/sessions?limit=20'); if (!r.ok) throw new Error(r.status);
            const d = await r.json(); const allSessions = d.data || [];
            label.textContent = 'updated ' + new Date().toLocaleTimeString();

            const active = allSessions.filter(s => !s.ended_at);
            const totalCost = allSessions.reduce((s, x) => s + (x.estimated_cost_usd || 0), 0);
            const totalMsgs = allSessions.reduce((s, x) => s + (x.message_count || 0), 0);

            $('#summaryBar').innerHTML = [
                { val: allSessions.length, label: 'sessions' },
                { val: active.length, label: 'active' },
                { val: '$' + totalCost.toFixed(4), label: 'cost' },
                { val: totalMsgs, label: 'messages' },
            ].map(s => '<div class="summary-card"><div class="sc-value">' + s.val + '</div><div class="sc-label">' + s.label + '</div></div>').join('');

            const agentsEl = $('#activeAgents');
            if (active.length === 0) { agentsEl.innerHTML = '<div class="empty-state">no active agents</div>'; }
            else {
                agentsEl.innerHTML = active.map(s => {
                    const elapsed = s.started_at ? formatDuration(s.started_at * 1000, Date.now()) : '\u2014';
                    return cardHTML(s.title, [
                        { label: 'model', val: s.model || '\u2014' }, { label: 'msgs', val: s.message_count || 0 },
                        { label: 'tools', val: s.tool_call_count || 0 }, { label: 'tokens', val: ((s.input_tokens || 0) + (s.output_tokens || 0)).toLocaleString() },
                        { label: 'cost', val: '$' + (s.estimated_cost_usd || 0).toFixed(4) }, { label: 'active', val: elapsed },
                    ]);
                }).join('');
            }

            const recent = allSessions.slice(0, 10);
            const recentEl = $('#recentActivity');
            if (recent.length === 0) { recentEl.innerHTML = '<div class="empty-state">no recent sessions</div>'; }
            else {
                recentEl.innerHTML = recent.map(s => {
                    const running = !s.ended_at; const errored = s.end_reason === 'error';
                    const statusBadge = running ? '<span class="badge badge-blue">running</span>'
                        : errored ? '<span class="badge badge-red">error</span>' : '<span class="badge badge-green">done</span>';
                    const duration = s.started_at && s.ended_at ? formatDuration(s.started_at * 1000, s.ended_at * 1000)
                        : s.started_at ? formatDuration(s.started_at * 1000, Date.now()) : '\u2014';
                    return cardHTML(s.title, [
                        { label: 'status', val: statusBadge, raw: true }, { label: 'duration', val: duration },
                        { label: 'msgs', val: s.message_count || 0 }, { label: 'cost', val: '$' + (s.estimated_cost_usd || 0).toFixed(4) },
                    ]);
                }).join('');
            }
        } catch (err) {
            label.textContent = '';
            $('#summaryBar').innerHTML = '';
            $('#activeAgents').innerHTML = '<div class="empty-state">failed: ' + esc(err.message) + '</div>';
            $('#recentActivity').innerHTML = '';
        }
    }

    function cardHTML(title, metaItems) {
        return '<div class="info-card"><div class="card-title">' + esc(title || 'Untitled') + '</div><div class="card-meta">' +
            metaItems.map(m => '<span class="meta-item"><span class="meta-label">' + m.label + ':</span> ' + (m.raw ? m.val : esc(String(m.val))) + '</span>').join('') +
            '</div></div>';
    }

    function formatDuration(fromMs, toMs) {
        const sec = Math.floor((toMs - fromMs) / 1000);
        if (sec < 60) return sec + 's'; if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
        const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); return h + 'h ' + m + 'm';
    }

    // ── Remote Desktop ──
    const RD_STORAGE_KEY = 'hermes-remote-desktop-v1';
    let rdConfig = { wsUrl: '', quality: 60 };
    let rdWs = null; let rdScreenW = 1920, rdScreenH = 1080;
    let rdMode = 'trackpad'; let rdFrameCount = 0; let rdConnected = false;
    let rdReconnectTimer = null; let rdReconnectDelay = 1000; let rdActive = false;

    const rdCanvas = $('#remoteCanvas');
    const rdCtx = rdCanvas ? rdCanvas.getContext('2d') : null;
    const rdDot = $('#remoteDot');
    const rdStatusText = $('#remoteStatusText');
    const rdFps = $('#remoteFps');
    const rdTouchCursor = $('#remoteTouchCursor');
    const rdConnectMsg = $('#remoteConnectMsg');
    const rdHiddenInput = $('#remoteHiddenInput');
    const rdScreen = $('#remoteScreen');

    try { const saved = JSON.parse(localStorage.getItem(RD_STORAGE_KEY)); if (saved) rdConfig = { ...rdConfig, ...saved }; } catch {}
    if (!rdConfig.wsUrl && isLocal) rdConfig.wsUrl = 'ws://localhost:8644/ws';

    const rdConnectBtn = $('#remoteConnectBtn');
    if (rdConnectBtn) rdConnectBtn.addEventListener('click', () => {
        const url = $('#remoteUrlInput').value.trim();
        if (url) { rdConfig.wsUrl = url; localStorage.setItem(RD_STORAGE_KEY, JSON.stringify(rdConfig)); rdConnect(); }
    });
    if ($('#remoteUrlInput')) $('#remoteUrlInput').value = rdConfig.wsUrl || '';

    function rdConnect() {
        if (rdWs && (rdWs.readyState === WebSocket.CONNECTING || rdWs.readyState === WebSocket.OPEN)) rdWs.close();
        if (!rdConfig.wsUrl) return;
        try { rdWs = new WebSocket(rdConfig.wsUrl); } catch (e) { rdScheduleReconnect(); return; }
        rdWs.onopen = () => { rdConnected = true; rdReconnectDelay = 1000; if (rdDot) rdDot.classList.add('connected'); if (rdStatusText) rdStatusText.textContent = 'connected'; if (rdConnectMsg) rdConnectMsg.classList.add('hidden'); };
        rdWs.onmessage = (evt) => { try { const msg = JSON.parse(evt.data); if (msg.type === 'frame') { rdRenderFrame(msg.data); rdFrameCount++; } else if (msg.type === 'info') { rdScreenW = msg.screen_width; rdScreenH = msg.screen_height; if (rdCanvas) { rdCanvas.width = rdScreenW; rdCanvas.height = rdScreenH; } } } catch {} };
        rdWs.onclose = () => { rdConnected = false; if (rdDot) rdDot.classList.remove('connected'); if (rdStatusText) rdStatusText.textContent = 'disconnected'; rdScheduleReconnect(); };
        rdWs.onerror = () => {};
    }
    function rdScheduleReconnect() { if (rdReconnectTimer) clearTimeout(rdReconnectTimer); if (!rdActive) return; if (rdStatusText) rdStatusText.textContent = 'reconnecting...'; rdReconnectTimer = setTimeout(() => { rdReconnectTimer = null; rdConnect(); }, rdReconnectDelay); rdReconnectDelay = Math.min(rdReconnectDelay * 1.5, 10000); }
    function rdRenderFrame(b64) { if (!rdCtx) return; const img = new Image(); img.onload = () => { rdCtx.drawImage(img, 0, 0, rdCanvas.width, rdCanvas.height); URL.revokeObjectURL(img.src); }; img.src = 'data:image/jpeg;base64,' + b64; }
    function rdSend(data) { if (rdWs && rdWs.readyState === WebSocket.OPEN) rdWs.send(JSON.stringify({ type: 'control', ...data })); }
    function rdGetCoords(clientX, clientY) { if (!rdCanvas) return { x: 0, y: 0 }; const rect = rdCanvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) }; }

    setInterval(() => { if (rdFps) rdFps.textContent = rdFrameCount + ' fps'; rdFrameCount = 0; if (rdWs && rdWs.readyState === WebSocket.OPEN) rdWs.send(JSON.stringify({ type: 'ping' })); }, 1000);

    // Trackpad mode
    let tp = { startX: 0, startY: 0, lastX: 0, lastY: 0, startTime: 0, moved: false, longPress: null, dragging: false, touches: 0 };
    function tpDown(e) { e.preventDefault(); const t = e.touches ? e.touches[0] : e; tp.touches = e.touches ? e.touches.length : 1; tp.startX = t.clientX; tp.startY = t.clientY; tp.lastX = t.clientX; tp.lastY = t.clientY; tp.startTime = Date.now(); tp.moved = false; tp.dragging = false; if (rdTouchCursor) { rdTouchCursor.style.left = t.clientX + 'px'; rdTouchCursor.style.top = t.clientY + 'px'; rdTouchCursor.style.display = 'block'; rdTouchCursor.style.borderColor = 'rgba(74,246,38,0.8)'; } if (tp.touches === 1) { tp.longPress = setTimeout(() => { if (!tp.moved) { rdSend({ action: 'rightclick', ...rdGetCoords(tp.startX, tp.startY) }); if (rdTouchCursor) rdTouchCursor.style.borderColor = 'rgba(255,100,100,0.8)'; } }, 500); } }
    function tpMove(e) { e.preventDefault(); const t = e.touches ? e.touches[0] : e; const touches = e.touches ? e.touches.length : 1; const dy = t.clientY - tp.lastY; const dist = Math.abs(t.clientX - tp.startX) + Math.abs(t.clientY - tp.startY); if (dist > 8) { tp.moved = true; if (tp.longPress) { clearTimeout(tp.longPress); tp.longPress = null; } } if (touches === 2 && e.touches) { rdSend({ action: 'scroll', amount: Math.round(-dy * 0.5), x: 0.5, y: 0.5 }); } else if (touches === 1 && tp.moved) { if (!tp.dragging) { tp.dragging = true; rdSend({ action: 'mousedown', ...rdGetCoords(tp.startX, tp.startY) }); } const coords = rdGetCoords(t.clientX, t.clientY); rdSend({ action: 'move', x: coords.x, y: coords.y }); if (rdTouchCursor) { rdTouchCursor.style.left = t.clientX + 'px'; rdTouchCursor.style.top = t.clientY + 'px'; } } tp.lastX = t.clientX; tp.lastY = t.clientY; }
    function tpUp(e) { if (tp.longPress) { clearTimeout(tp.longPress); tp.longPress = null; } const elapsed = Date.now() - tp.startTime; if (tp.dragging) { rdSend({ action: 'mouseup', ...rdGetCoords(tp.lastX, tp.lastY) }); tp.dragging = false; } else if (!tp.moved) { const coords = rdGetCoords(tp.startX, tp.startY); if (elapsed < 300) { rdSend(tp.touches === 2 ? { action: 'rightclick', ...coords } : { action: 'click', ...coords }); } } if (rdTouchCursor) rdTouchCursor.style.display = 'none'; tp.touches = 0; }
    function touchTap(e) { e.preventDefault(); const t = e.touches ? e.touches[0] : e; rdSend({ action: 'click', ...rdGetCoords(t.clientX, t.clientY) }); }
    let scrollLastY = 0;
    function scrollDown(e) { e.preventDefault(); scrollLastY = (e.touches ? e.touches[0] : e).clientY; }
    function scrollMove(e) { e.preventDefault(); const t = e.touches ? e.touches[0] : e; const dy = t.clientY - scrollLastY; if (Math.abs(dy) > 5) { rdSend({ action: 'scroll', amount: Math.round(-dy * 0.3), x: 0.5, y: 0.5 }); scrollLastY = t.clientY; } }

    function rdBindEvents() {
        if (!rdScreen) return; const el = rdScreen;
        el.onmousedown = el.ontouchstart = el.onmousemove = el.ontouchmove = el.onmouseup = el.ontouchend = el.ontouchcancel = null;
        el.removeEventListener('mousedown', tpDown); el.removeEventListener('touchstart', tpDown);
        el.removeEventListener('mousemove', tpMove); el.removeEventListener('touchmove', tpMove);
        el.removeEventListener('mouseup', tpUp); el.removeEventListener('touchend', tpUp); el.removeEventListener('touchcancel', tpUp);
        el.removeEventListener('mousedown', touchTap); el.removeEventListener('touchstart', touchTap);
        el.removeEventListener('mousedown', scrollDown); el.removeEventListener('touchstart', scrollDown);
        el.removeEventListener('mousemove', scrollMove); el.removeEventListener('touchmove', scrollMove);
        const opts = { passive: false };
        if (rdMode === 'trackpad') { el.addEventListener('mousedown', tpDown, opts); el.addEventListener('touchstart', tpDown, opts); el.addEventListener('mousemove', tpMove, opts); el.addEventListener('touchmove', tpMove, opts); el.addEventListener('mouseup', tpUp, opts); el.addEventListener('touchend', tpUp, opts); el.addEventListener('touchcancel', tpUp, opts); }
        else if (rdMode === 'touch') { el.addEventListener('mousedown', touchTap, opts); el.addEventListener('touchstart', touchTap, opts); }
        else if (rdMode === 'scroll') { el.addEventListener('mousedown', scrollDown, opts); el.addEventListener('touchstart', scrollDown, opts); el.addEventListener('mousemove', scrollMove, opts); el.addEventListener('touchmove', scrollMove, opts); }
    }

    function rdSetMode(mode) { rdMode = mode; document.querySelectorAll('.remote-btn').forEach(b => b.classList.remove('active')); const btnMap = { trackpad: '#rdTrackpad', touch: '#rdTouch', scroll: '#rdScroll' }; if (btnMap[mode]) $(btnMap[mode])?.classList.add('active'); rdBindEvents(); showToast(document.querySelector('.remote-mode-toast'), { trackpad: 'trackpad', touch: 'touch', scroll: 'scroll' }[mode] || mode); }
    function showToast(el, text) { if (!el) { el = document.createElement('div'); el.className = 'remote-mode-toast'; rdScreen?.appendChild(el); } el.textContent = text; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 1200); }

    $('#rdTrackpad')?.addEventListener('click', () => rdSetMode('trackpad'));
    $('#rdTouch')?.addEventListener('click', () => rdSetMode('touch'));
    $('#rdScroll')?.addEventListener('click', () => rdSetMode('scroll'));
    $('#rdKeyboard')?.addEventListener('click', () => { if (rdHiddenInput) { rdHiddenInput.focus(); rdHiddenInput.click?.(); } });

    if (rdHiddenInput) {
        rdHiddenInput.addEventListener('input', () => { if (rdHiddenInput.value) { rdSend({ action: 'typetext', text: rdHiddenInput.value }); rdHiddenInput.value = ''; } });
        rdHiddenInput.addEventListener('keydown', (e) => { const keyMap = { Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Escape: 'escape' }; if (keyMap[e.key]) { rdSend({ action: 'key', key: keyMap[e.key] }); e.preventDefault(); } });
    }

    const SPECIAL_KEYS = [
        { label: 'Cmd+C', keys: ['command', 'c'] }, { label: 'Cmd+V', keys: ['command', 'v'] },
        { label: 'Cmd+Z', keys: ['command', 'z'] }, { label: 'Cmd+A', keys: ['command', 'a'] },
        { label: 'Cmd+S', keys: ['command', 's'] }, { label: 'Cmd+W', keys: ['command', 'w'] },
        { label: 'Cmd+Q', keys: ['command', 'q'] }, { label: 'Cmd+Tab', keys: ['command', 'tab'] },
        { label: 'Cmd+Spc', keys: ['command', 'space'] }, { label: 'Cmd+Sh+Z', keys: ['command', 'shift', 'z'] },
        { label: 'ESC', keys: ['escape'] }, { label: 'Enter', keys: ['enter'] },
        { label: 'Bksp', keys: ['backspace'] }, { label: 'Tab', keys: ['tab'] },
        { label: '\u2191', keys: ['up'] }, { label: '\u2193', keys: ['down'] },
        { label: '\u2190', keys: ['left'] }, { label: '\u2192', keys: ['right'] },
    ];

    let keysMenuEl = null;
    function buildKeysMenu() {
        if (keysMenuEl) return;
        keysMenuEl = document.createElement('div'); keysMenuEl.className = 'remote-keys-menu';
        SPECIAL_KEYS.forEach(sk => { const btn = document.createElement('button'); btn.className = 'remote-key-btn'; btn.textContent = sk.label; btn.addEventListener('click', () => rdSend({ action: 'hotkey', keys: sk.keys })); btn.addEventListener('touchstart', (e) => { e.preventDefault(); rdSend({ action: 'hotkey', keys: sk.keys }); }); keysMenuEl.appendChild(btn); });
        rdScreen?.appendChild(keysMenuEl);
    }
    $('#rdKeys')?.addEventListener('click', () => { buildKeysMenu(); keysMenuEl?.classList.toggle('show'); });
    $('#rdFullscreen')?.addEventListener('click', () => { const el = $('#tabRemote'); if (!el) return; if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.(); });

    rdScreen?.addEventListener('contextmenu', e => e.preventDefault());
    rdScreen?.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (rdActive && e.target.closest('.remote-screen')) e.preventDefault(); }, { passive: false });
})();
