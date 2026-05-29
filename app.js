// Hermes Chat UI v6 (terminal-style)
(() => {
    'use strict';

    const DEFAULT_API_URL = 'http://localhost:8642';
    const TUNNEL_URL = 'https://continuing-raleigh-respectively-now.trycloudflare.com';
    const TUNNEL_URL_SOURCE = 'https://raw.githubusercontent.com/LantzBrown/hermes-chat/main/tunnel-url.json';
    const DEFAULT_API_KEY='bzJg4-OgW2sP13g8G7uAeEAkt7KciUGu6BQUq-_VZcw';
    const STORAGE_KEY = 'hermes-chat-config-v9';

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

    // Lock screen
    const LOCK_PASSWORD = 'Lantz_040405';
    const lockScreen = document.getElementById('lockScreen');
    const lockForm = document.getElementById('lockForm');
    const lockPassword = document.getElementById('lockPassword');
    const lockError = document.getElementById('lockError');
    const mainApp = document.getElementById('mainApp');
    function unlockApp() { lockScreen.classList.add('hidden'); mainApp.style.display = ''; messageInput.focus(); }
    if (sessionStorage.getItem('hermes-unlocked') === 'true') unlockApp();
    lockForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (lockPassword.value === LOCK_PASSWORD) { lockError.textContent = ''; sessionStorage.setItem('hermes-unlocked', 'true'); unlockApp(); }
        else { lockError.textContent = 'access denied.'; lockPassword.value = ''; lockPassword.focus(); }
    });

    checkHealth();
    loadSessionsFromServer();
    messageInput.focus();
    setInterval(checkHealth, 30000);

    // Nav tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const name = tab.dataset.tab;
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab' + name.charAt(0).toUpperCase() + name.slice(1)));
            if (name === 'cron') loadCronJobs();
            if (name === 'overview') loadOverview();
            const inputArea = document.querySelector('.input-area');
            if (inputArea) inputArea.style.display = name === 'chat' ? '' : 'none';
        });
    });

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
                config.apiUrl = data.url;
                saveConfig();
            }
        } catch {}
    }
    if (!isLocal) discoverTunnelUrl();

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

    function toggleSessions() { sessionPicker.classList.toggle('open'); if (sessionPicker.classList.contains('open')) renderSessionList(); }

    function renderSessionList() {
        const sorted = Object.values(sessions).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
        if (sorted.length === 0) { sessionList.innerHTML = '<div class="session-empty">no conversations yet</div>'; return; }
        sessionList.innerHTML = sorted.map(s => {
            const d = new Date(s.updatedAt || s.createdAt);
            const t = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return '<div class="session-item' + (s.id === activeSessionId ? ' active' : '') + '" data-id="' + s.id + '"><span class="session-item-title">' + esc(s.title) + '</span><span class="session-item-time">' + t + '</span><button class="session-item-del" data-id="' + s.id + '">&#10005;</button></div>';
        }).join('');
        sessionList.querySelectorAll('.session-item').forEach(el => { el.addEventListener('click', e => { if (!e.target.closest('.session-item-del')) switchToSession(el.dataset.id); }); });
        sessionList.querySelectorAll('.session-item-del').forEach(btn => { btn.addEventListener('click', e => { e.stopPropagation(); deleteSession(btn.dataset.id); }); });
    }

    async function switchToSession(id) {
        activeSessionId = id; const s = sessions[id]; if (!s) return;
        welcomeScreen.style.display = 'none'; messagesEl.classList.add('active'); messagesEl.innerHTML = '';
        if (s.messages.length === 0) await loadSessionMessages(id);
        s.messages.forEach(m => appendMessage(m.role, m.content, false));
        renderSessionList(); scrollToBottom(); messageInput.focus(); sessionPicker.classList.remove('open');
    }

    async function deleteSession(id) {
        try { await api('/api/sessions/' + id, { method: 'DELETE' }); } catch {}
        delete sessions[id]; if (activeSessionId === id) newChat(); else renderSessionList();
    }

    function autoResize() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
        sendBtn.disabled = !messageInput.value.trim() || isStreaming;
    }

    function handleKeydown(e) {
        if (cmdPalette && cmdPalette.classList.contains('active')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); navigateCmd(1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); navigateCmd(-1); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectCmd(); return; }
            if (e.key === 'Escape') { closeCmdPalette(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isStreaming && messageInput.value.trim()) sendMessage(); }
    }

    function newChat() {
        activeSessionId = null; messagesEl.innerHTML = ''; messagesEl.classList.remove('active');
        welcomeScreen.style.display = ''; renderSessionList(); messageInput.value = ''; autoResize(); messageInput.focus();
    }

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
                                if (delta?.content) { fullContent += delta.content; if (fullContent.length === delta.content.length) updateThinkingLabel('responding...'); bodyEl.innerHTML = renderMd(fullContent); }
                                if (parsed.type === 'content' && parsed.content) { fullContent += parsed.content; if (fullContent.length === parsed.content.length) updateThinkingLabel('responding...'); bodyEl.innerHTML = renderMd(fullContent); }
                                if (parsed.type === 'text' && parsed.text) { fullContent += parsed.text; if (fullContent.length === parsed.text.length) updateThinkingLabel('responding...'); bodyEl.innerHTML = renderMd(fullContent); }
                                if (parsed.message?.content && !fullContent) { fullContent = parsed.message.content; bodyEl.innerHTML = renderMd(fullContent); }
                            } catch {}
                        }
                        scrollToBottom();
                    }
                }
            } catch (streamErr) { if (streamingOk) throw streamErr; }

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
                    const fd = await resp.json();
                    fullContent = fd.message?.content || fd.content || '';
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
            else { appendMessage('error', 'failed to connect: ' + err.message, false); session.messages.pop(); }
        } finally { showStreamingUI(false); autoResize(); messageInput.focus(); }
    }

    function stopGeneration() { if (abortController) abortController.abort(); }

    function showStreamingUI(streaming) {
        isStreaming = streaming; sendBtn.style.display = streaming ? 'none' : 'flex';
        stopBtn.style.display = streaming ? 'flex' : 'none'; sendBtn.disabled = true;
        messageInput.disabled = false; messageInput.placeholder = streaming ? 'hermes is working...' : '';
        if (streaming) showThinking();
    }

    const SPINNER_FACES = ['(^_^)', '(⚔)', '(⌁)', '(✧)', '(▸▸)'];
    let spinnerIdx = 0;
    function showThinking(label) {
        removeThinking(); thinkingEl = document.createElement('div'); thinkingEl.className = 'thinking';
        const face = SPINNER_FACES[spinnerIdx % SPINNER_FACES.length]; spinnerIdx++;
        thinkingEl.innerHTML = '<div class="thinking-inner"><span class="thinking-face">' + face + '</span><span class="thinking-label">' + esc(label || 'thinking...') + '</span></div>';
        messagesEl.appendChild(thinkingEl); scrollToBottom();
    }
    function updateThinkingLabel(label) { if (!thinkingEl) return; const lbl = thinkingEl.querySelector('.thinking-label'); if (lbl) lbl.textContent = label; }
    function removeThinking() { if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; } if (activityEl) { activityEl.remove(); activityEl = null; } }

    function showActivityLog() {
        if (activityEl) return; activityEl = document.createElement('div'); activityEl.className = 'activity-log';
        if (thinkingEl) thinkingEl.after(activityEl); else messagesEl.appendChild(activityEl);
    }
    function addActivityItem(icon, text) {
        if (!activityEl) showActivityLog();
        const item = document.createElement('div'); item.className = 'activity-item';
        const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        item.innerHTML = '<span class="activity-icon">' + icon + '</span><span class="activity-text">' + esc(text) + '</span><span class="activity-time">' + time + '</span>';
        activityEl.appendChild(item); scrollToBottom();
    }

    function appendMessage(role, content, streaming) {
        const div = document.createElement('div'); div.className = 'message ' + role;
        if (role === 'assistant') {
            div.innerHTML = '<div class="msg-box"><div class="msg-body">' + (streaming ? '' : renderMd(content)) + '</div></div>';
        } else {
            const label = role === 'error' ? '<span class="msg-label">error: </span>' : '';
            div.innerHTML = '<div class="msg-body">' + label + (streaming ? '' : renderMd(content)) + '</div>';
        }
        messagesEl.appendChild(div); scrollToBottom();
        const bodyEl = div.querySelector('.msg-body');
        if (!streaming && content) { bodyEl.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b)); addCodeCopyButtons(bodyEl); }
        return { messageEl: div, bodyEl };
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

    function scrollToBottom() { requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }); }
    function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    // Command palette
    const COMMANDS = [
        { name: '/new', desc: 'start a new conversation', icon: '\u2728', action: 'newChat' },
        { name: '/clear', desc: 'clear and start fresh', icon: '\ud83e\uddf9', action: 'newChat' },
        { name: '/sessions', desc: 'show all conversations', icon: '\ud83d\udccb', action: 'showSessionsCmd' },
        { name: '/settings', desc: 'open settings', icon: '\u2699', action: 'openSettingsCmd' },
        { name: '/stop', desc: 'stop current response', icon: '\u23f9', action: 'stopGeneration' },
        { name: '/help', desc: 'show available commands', icon: '?', action: 'showHelp' },
    ];
    let cmdSelected = -1;
    const cmdPalette = $('#cmdPalette');

    function onInput() {
        autoResize();
        const val = messageInput.value;
        if (val === '/') openCmdPalette('');
        else if (val.startsWith('/')) openCmdPalette(val);
        else closeCmdPalette();
    }

    function openCmdPalette(query) {
        const q = query.replace(/^\//, '').toLowerCase();
        const filtered = COMMANDS.filter(c => c.name.toLowerCase().includes('/' + q) || c.desc.toLowerCase().includes(q));
        if (filtered.length === 0) { closeCmdPalette(); return; }
        cmdPalette.innerHTML = '<div class="cmd-palette-header">commands</div>' +
            filtered.map((c, i) => '<div class="cmd-item' + (i === 0 ? ' selected' : '') + '" data-action="' + c.action + '"><span class="cmd-item-icon">' + c.icon + '</span><div class="cmd-item-info"><div class="cmd-item-name">' + c.name + '</div><div class="cmd-item-desc">' + c.desc + '</div></div></div>').join('');
        cmdPalette.classList.add('active'); cmdSelected = 0;
        cmdPalette.querySelectorAll('.cmd-item').forEach(el => {
            el.addEventListener('click', () => { closeCmdPalette(); messageInput.value = ''; autoResize(); if (typeof window[el.dataset.action] === 'function') window[el.dataset.action](); });
        });
    }
    function closeCmdPalette() { cmdPalette.classList.remove('active'); cmdSelected = -1; }
    function navigateCmd(dir) {
        const items = cmdPalette.querySelectorAll('.cmd-item'); if (items.length === 0) return;
        items[cmdSelected]?.classList.remove('selected');
        cmdSelected = (cmdSelected + dir + items.length) % items.length;
        items[cmdSelected]?.classList.add('selected'); items[cmdSelected]?.scrollIntoView({ block: 'nearest' });
    }
    function selectCmd() {
        const items = cmdPalette.querySelectorAll('.cmd-item'); const el = items[cmdSelected];
        if (el) { closeCmdPalette(); messageInput.value = ''; autoResize(); if (typeof window[el.dataset.action] === 'function') window[el.dataset.action](); }
    }
    window.newChat = newChat;
    window.showSessionsCmd = toggleSessions;
    window.openSettingsCmd = openSettings;
    window.stopGeneration = stopGeneration;
    window.showHelp = () => { messageInput.value = ''; closeCmdPalette(); appendMessage('assistant', '**available commands:**\n\n' + COMMANDS.map(c => '- ' + c.icon + ' **' + c.name + '** \u2014 ' + c.desc).join('\n') + '\n\nyou can also just type anything to chat.', false); };

    // Settings
    function openSettings() { $('#apiUrl').value = config.apiUrl || ''; $('#apiKey').value = config.apiKey || ''; if ($('#sessionId')) $('#sessionId').value = config.sessionId || ''; if ($('#remoteWsUrl')) $('#remoteWsUrl').value = rdConfig.wsUrl || ''; $('#settingsModal').classList.add('active'); closeCmdPalette(); }
    function closeSettings() { $('#settingsModal').classList.remove('active'); }
    function saveSettings() {
        config.apiUrl = $('#apiUrl').value.replace(/\/+$/, '') || (isLocal ? DEFAULT_API_URL : TUNNEL_URL);
        config.apiKey = $('#apiKey').value.trim() || DEFAULT_API_KEY;
        if ($('#sessionId')) config.sessionId = $('#sessionId').value.trim();
        if ($('#remoteWsUrl')) { const newRdUrl = $('#remoteWsUrl').value.trim(); if (newRdUrl !== rdConfig.wsUrl) { rdConfig.wsUrl = newRdUrl; localStorage.setItem(RD_STORAGE_KEY, JSON.stringify(rdConfig)); if ($('#remoteUrlInput')) $('#remoteUrlInput').value = newRdUrl; } }
        saveConfig(); closeSettings(); checkHealth(); loadSessionsFromServer();
    }

    // Cron
    async function loadCronJobs() {
        const el = $('#cronContent'); const label = $('#cronRefreshLabel');
        try {
            const r = await api('/api/jobs'); if (!r.ok) throw new Error(r.status);
            const d = await r.json(); const jobs = d.jobs || [];
            label.textContent = 'updated ' + new Date().toLocaleTimeString();
            if (jobs.length === 0) { el.innerHTML = '<div class="empty-state">no cron jobs</div>'; return; }
            el.innerHTML = jobs.map(j => {
                const enabled = j.enabled !== false;
                return '<div class="info-card"><div class="card-title">' + esc(j.name || 'unnamed') + '</div><div class="card-meta"><span class="meta-item"><span class="meta-label">schedule:</span> ' + esc(j.schedule || '-') + '</span><span class="meta-item">' + (enabled ? '<span class="badge badge-green">on</span>' : '<span class="badge badge-muted">off</span>') + '</span><span class="meta-item"><span class="meta-label">last:</span> ' + (j.last_run_at ? new Date(j.last_run_at * 1000).toLocaleString() : 'never') + '</span></div></div>';
            }).join('');
        } catch (err) { label.textContent = ''; el.innerHTML = '<div class="empty-state">failed: ' + esc(err.message) + '</div>'; }
    }

    // Overview
    async function loadOverview() {
        const label = $('#overviewRefreshLabel');
        try {
            const r = await api('/api/sessions?limit=20'); if (!r.ok) throw new Error(r.status);
            const d = await r.json(); const all = d.data || [];
            label.textContent = 'updated ' + new Date().toLocaleTimeString();
            const active = all.filter(s => !s.ended_at);
            const totalCost = all.reduce((s, x) => s + (x.estimated_cost_usd || 0), 0);
            const totalMsgs = all.reduce((s, x) => s + (x.message_count || 0), 0);
            $('#summaryBar').innerHTML = [{ val: all.length, label: 'sessions' }, { val: active.length, label: 'active' }, { val: '$' + totalCost.toFixed(4), label: 'cost' }, { val: totalMsgs, label: 'messages' }].map(s => '<div class="summary-card"><div class="sc-value">' + s.val + '</div><div class="sc-label">' + s.label + '</div></div>').join('');
            const agentsEl = $('#activeAgents');
            agentsEl.innerHTML = active.length === 0 ? '<div class="empty-state">no active agents</div>' : active.map(s => {
                const elapsed = s.started_at ? fmtDur(s.started_at * 1000, Date.now()) : '-';
                return '<div class="info-card"><div class="card-title">' + esc(s.title || 'untitled') + '</div><div class="card-meta"><span class="meta-item"><span class="meta-label">model:</span> ' + esc(s.model || '-') + '</span><span class="meta-item"><span class="meta-label">msgs:</span> ' + (s.message_count || 0) + '</span><span class="meta-item"><span class="meta-label">cost:</span> $' + (s.estimated_cost_usd || 0).toFixed(4) + '</span><span class="meta-item"><span class="meta-label">active:</span> ' + elapsed + '</span></div></div>';
            }).join('');
            const recent = all.slice(0, 10);
            const recentEl = $('#recentActivity');
            recentEl.innerHTML = recent.length === 0 ? '<div class="empty-state">no recent sessions</div>' : recent.map(s => {
                const running = !s.ended_at; const badge = running ? '<span class="badge badge-blue">running</span>' : s.end_reason === 'error' ? '<span class="badge badge-red">error</span>' : '<span class="badge badge-green">done</span>';
                return '<div class="info-card"><div class="card-title">' + esc(s.title || 'untitled') + '</div><div class="card-meta"><span class="meta-item">' + badge + '</span><span class="meta-item"><span class="meta-label">msgs:</span> ' + (s.message_count || 0) + '</span><span class="meta-item"><span class="meta-label">cost:</span> $' + (s.estimated_cost_usd || 0).toFixed(4) + '</span></div></div>';
            }).join('');
        } catch (err) { label.textContent = ''; $('#summaryBar').innerHTML = ''; $('#activeAgents').innerHTML = '<div class="empty-state">failed: ' + esc(err.message) + '</div>'; $('#recentActivity').innerHTML = ''; }
    }
    function fmtDur(fromMs, toMs) { const sec = Math.floor((toMs - fromMs) / 1000); if (sec < 60) return sec + 's'; if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's'; return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm'; }

    // Remote Desktop
    const RD_STORAGE_KEY = 'hermes-remote-desktop-v1';
    let rdConfig = { wsUrl: '', quality: 60 }; let rdWs = null; let rdScreenW = 1920; let rdScreenH = 1080; let rdMode = 'trackpad'; let rdFrameCount = 0; let rdConnected = false; let rdReconnectTimer = null; let rdReconnectDelay = 1000;
    const rdCanvas = $('#remoteCanvas'); const rdCtx = rdCanvas ? rdCanvas.getContext('2d') : null; const rdDot = $('#remoteDot'); const rdStatusText = $('#remoteStatusText'); const rdFps = $('#remoteFps'); const rdTouchCursor = $('#remoteTouchCursor'); const rdConnectMsg = $('#remoteConnectMsg'); const rdHiddenInput = $('#remoteHiddenInput'); const rdScreen = $('#remoteScreen');
    try { const saved = JSON.parse(localStorage.getItem(RD_STORAGE_KEY)); if (saved) rdConfig = { ...rdConfig, ...saved }; } catch {}
    if (!rdConfig.wsUrl && isLocal) rdConfig.wsUrl = 'ws://localhost:8644/ws';
    const rdConnectBtn = $('#remoteConnectBtn');
    if (rdConnectBtn) rdConnectBtn.addEventListener('click', () => { const url = $('#remoteUrlInput').value.trim(); if (url) { rdConfig.wsUrl = url; localStorage.setItem(RD_STORAGE_KEY, JSON.stringify(rdConfig)); rdConnect(); } });
    if ($('#remoteUrlInput')) $('#remoteUrlInput').value = rdConfig.wsUrl || '';
    ['rdTrackpad', 'rdTouch', 'rdScroll'].forEach(id => { const el = $('#' + id); if (el) el.addEventListener('click', () => { document.querySelectorAll('.remote-btn').forEach(b => b.classList.remove('active')); el.classList.add('active'); rdMode = id === 'rdTrackpad' ? 'trackpad' : id === 'rdTouch' ? 'touch' : 'scroll'; }); });
    if ($('#rdKeyboard')) $('#rdKeyboard').addEventListener('click', () => { if (rdHiddenInput) rdHiddenInput.focus(); });
    if ($('#rdFullscreen')) $('#rdFullscreen').addEventListener('click', () => { if (rdScreen) rdScreen.requestFullscreen?.(); });

    function rdConnect() {
        if (rdWs && (rdWs.readyState === WebSocket.CONNECTING || rdWs.readyState === WebSocket.OPEN)) rdWs.close();
        if (!rdConfig.wsUrl) return;
        try { rdWs = new WebSocket(rdConfig.wsUrl); } catch { rdScheduleReconnect(); return; }
        rdWs.onopen = () => { rdConnected = true; rdReconnectDelay = 1000; if (rdDot) rdDot.classList.add('connected'); if (rdStatusText) rdStatusText.textContent = 'connected'; if (rdConnectMsg) rdConnectMsg.classList.add('hidden'); };
        rdWs.onmessage = (evt) => { try { const msg = JSON.parse(evt.data); if (msg.type === 'frame') { rdRenderFrame(msg.data); rdFrameCount++; } else if (msg.type === 'info') { rdScreenW = msg.screen_width; rdScreenH = msg.screen_height; } } catch {} };
        rdWs.onclose = () => { rdConnected = false; if (rdDot) rdDot.classList.remove('connected'); if (rdStatusText) rdStatusText.textContent = 'disconnected'; rdScheduleReconnect(); };
        rdWs.onerror = () => {};
    }
    function rdScheduleReconnect() { if (rdReconnectTimer) return; rdReconnectTimer = setTimeout(() => { rdReconnectTimer = null; if (rdConfig.wsUrl) rdConnect(); }, rdReconnectDelay); rdReconnectDelay = Math.min(rdReconnectDelay * 1.5, 10000); }
    function rdRenderFrame(base64) { if (!rdCanvas || !rdCtx) return; const img = new Image(); img.onload = () => { rdCanvas.width = img.width; rdCanvas.height = img.height; rdCtx.drawImage(img, 0, 0); if (rdFps) rdFps.textContent = rdFrameCount + ' fps'; }; img.src = 'data:image/jpeg;base64,' + base64; }
    if (rdScreen) {
        let lastMouse = { x: 0, y: 0 };
        rdScreen.addEventListener('mousemove', (e) => { if (!rdConnected || rdMode !== 'trackpad') return; const rect = rdCanvas.getBoundingClientRect(); const x = Math.round((e.clientX - rect.left) / rect.width * rdScreenW); const y = Math.round((e.clientY - rect.top) / rect.height * rdScreenH); if (x !== lastMouse.x || y !== lastMouse.y) { lastMouse = { x, y }; if (rdWs?.readyState === WebSocket.OPEN) rdWs.send(JSON.stringify({ type: 'mouse', action: 'move', x, y })); } });
        rdScreen.addEventListener('mousedown', (e) => { if (!rdConnected) return; if (rdWs?.readyState === WebSocket.OPEN) rdWs.send(JSON.stringify({ type: 'mouse', action: 'click', button: e.button === 2 ? 'right' : 'left' })); });
        rdScreen.addEventListener('contextmenu', (e) => e.preventDefault());
        rdScreen.addEventListener('wheel', (e) => { if (!rdConnected || rdMode !== 'scroll') return; e.preventDefault(); if (rdWs?.readyState === WebSocket.OPEN) rdWs.send(JSON.stringify({ type: 'scroll', dy: Math.round(e.deltaY) })); }, { passive: false });
    }
    if (rdConfig.wsUrl) rdConnect();
})();
