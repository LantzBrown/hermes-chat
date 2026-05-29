// ── Hermes Chat UI v6 (terminal-style) ──
(() => {
    'use strict';

    const DEFAULT_API_URL = 'http://localhost:8642';
    const TUNNEL_URL = 'https://continuing-raleigh-respectively-now.trycloudflare.com';
    const TUNNEL_URL_SOURCE = 'https://raw.githubusercontent.com/LantzBrown/hermes-chat/main/tunnel-url.json';
    const DEFAULT_API_KEY = 'bzJg4-OgW2sP13g8G7uAeEAkt7KciUGu6BQUq-_VZcw';
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

    // ── Init ──
    checkHealth();
    loadSessionsFromServer();
    messageInput.focus();
    setInterval(checkHealth, 30000);

    // ── Events ──
    messageInput.addEventListener('input', autoResize);
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
        if (!sessionPicker.contains(e.target) && e.target !== $('#sessionsBtn') && !$('#sessionsBtn').contains(e.target)) {
            sessionPicker.classList.remove('open');
        }
    });

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

    // ── Tunnel Discovery ──
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

    // ── Health ──
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

    // ── Sessions ──
    async function loadSessionsFromServer() {
        try {
            const r = await api('/api/sessions');
            if (!r.ok) throw new Error(r.status);
            const d = await r.json();
            sessions = {};
            for (const s of (d.data || [])) {
                if (!s.id) continue;
                sessions[s.id] = {
                    id: s.id, title: s.title || 'Untitled', messages: [],
                    createdAt: (s.started_at || 0) * 1000,
                    updatedAt: (s.last_active || s.started_at || 0) * 1000,
                };
            }
            renderSessionList();
        } catch { renderSessionList(); }
    }

    async function loadSessionMessages(id) {
        try {
            const r = await api('/api/sessions/' + id + '/messages');
            if (!r.ok) throw new Error(r.status);
            const d = await r.json();
            sessions[id].messages = (d.data || [])
                .filter(m => m.content && (m.role === 'user' || m.role === 'assistant'))
                .map(m => ({ role: m.role, content: m.content }));
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

    function toggleSessions() {
        sessionPicker.classList.toggle('open');
        if (sessionPicker.classList.contains('open')) renderSessionList();
    }

    function renderSessionList() {
        const sorted = Object.values(sessions).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
        if (sorted.length === 0) { sessionList.innerHTML = '<div class="session-empty">no conversations yet</div>'; return; }
        sessionList.innerHTML = sorted.map(s => {
            const d = new Date(s.updatedAt || s.createdAt);
            const t = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return '<div class="session-item' + (s.id === activeSessionId ? ' active' : '') + '" data-id="' + s.id + '">' +
                '<span class="session-item-title">' + esc(s.title) + '</span>' +
                '<span class="session-item-time">' + t + '</span>' +
                '<button class="session-item-del" data-id="' + s.id + '">✕</button></div>';
        }).join('');
        sessionList.querySelectorAll('.session-item').forEach(el => {
            el.addEventListener('click', e => { if (!e.target.closest('.session-item-del')) switchToSession(el.dataset.id); });
        });
        sessionList.querySelectorAll('.session-item-del').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); deleteSession(btn.dataset.id); });
        });
    }

    async function switchToSession(id) {
        activeSessionId = id;
        const s = sessions[id];
        if (!s) return;
        welcomeScreen.style.display = 'none';
        messagesEl.classList.add('active');
        messagesEl.innerHTML = '';
        if (s.messages.length === 0) await loadSessionMessages(id);
        s.messages.forEach(m => appendMessage(m.role, m.content, false));
        renderSessionList();
        scrollToBottom();
        messageInput.focus();
        sessionPicker.classList.remove('open');
    }

    async function deleteSession(id) {
        try { await api('/api/sessions/' + id, { method: 'DELETE' }); } catch {}
        delete sessions[id];
        if (activeSessionId === id) newChat(); else renderSessionList();
    }

    // ── Input ──
    function autoResize() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
        sendBtn.disabled = !messageInput.value.trim() || isStreaming;
    }

    function handleKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isStreaming && messageInput.value.trim()) sendMessage();
        }
    }

    // ── New Chat ──
    function newChat() {
        activeSessionId = null;
        messagesEl.innerHTML = '';
        messagesEl.classList.remove('active');
        welcomeScreen.style.display = '';
        renderSessionList();
        messageInput.value = '';
        autoResize();
        messageInput.focus();
    }

    // ── Send Message ──
    async function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || isStreaming) return;

        if (!activeSessionId) {
            const title = text.slice(0, 60) + (text.length > 60 ? '...' : '');
            activeSessionId = await createServerSession(title);
            sessions[activeSessionId] = { id: activeSessionId, title, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
            welcomeScreen.style.display = 'none';
            messagesEl.classList.add('active');
        }

        const session = sessions[activeSessionId];
        if (session.messages.length === 0) session.title = text.slice(0, 60) + (text.length > 60 ? '...' : '');
        session.messages.push({ role: 'user', content: text });
        session.updatedAt = Date.now();
        renderSessionList();
        appendMessage('user', text, false);

        messageInput.value = '';
        autoResize();
        showStreamingUI(true);

        try {
            abortController = new AbortController();
            let fullContent = '';
            let bodyEl;
            let activityStarted = false;
            let streamingOk = false;

            // Try streaming first, fall back to non-streaming
            try {
                const resp = await api('/api/sessions/' + activeSessionId + '/chat/stream', {
                    method: 'POST',
                    body: JSON.stringify({ message: text, stream: true }),
                    signal: abortController.signal,
                });

                if (resp.ok) {
                    streamingOk = true;
                    removeThinking();
                    const msg = appendMessage('assistant', '', true);
                    bodyEl = msg.bodyEl;

                    const reader = resp.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith('data:')) continue;
                            const data = trimmed.slice(5).trim();
                            if (data === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data);

                                if (parsed.type === 'tool_call' || parsed.tool_calls) {
                                    const toolName = parsed.name || parsed.tool_calls?.[0]?.function?.name || 'tool';
                                    if (!activityStarted) { showActivityLog(); activityStarted = true; }
                                    addActivityItem('▸', 'calling ' + toolName);
                                    updateThinkingLabel('calling ' + toolName + '...');
                                }
                                if (parsed.type === 'tool_result') {
                                    const toolName = parsed.name || 'tool';
                                    if (!activityStarted) { showActivityLog(); activityStarted = true; }
                                    addActivityItem('✓', toolName + ' done');
                                    updateThinkingLabel('processing results...');
                                }
                                if (parsed.type === 'thinking' || parsed.type === 'reasoning') {
                                    updateThinkingLabel('thinking...');
                                }

                                const delta = parsed.choices?.[0]?.delta;
                                if (delta?.content) {
                                    fullContent += delta.content;
                                    if (fullContent.length === delta.content.length) updateThinkingLabel('responding...');
                                    bodyEl.innerHTML = renderMd(fullContent);
                                }
                                if (parsed.type === 'content' && parsed.content) {
                                    fullContent += parsed.content;
                                    if (fullContent.length === parsed.content.length) updateThinkingLabel('responding...');
                                    bodyEl.innerHTML = renderMd(fullContent);
                                }
                                if (parsed.type === 'text' && parsed.text) {
                                    fullContent += parsed.text;
                                    if (fullContent.length === parsed.text.length) updateThinkingLabel('responding...');
                                    bodyEl.innerHTML = renderMd(fullContent);
                                }
                                if (parsed.message?.content && !fullContent) {
                                    fullContent = parsed.message.content;
                                    bodyEl.innerHTML = renderMd(fullContent);
                                }
                            } catch {}
                        }
                        scrollToBottom();
                    }
                }
            } catch (streamErr) {
                if (streamingOk) throw streamErr;
            }

            // Non-streaming fallback
            if (!fullContent) {
                removeThinking();
                showThinking('thinking...');

                let pollCount = 0;
                const seenToolCalls = new Set();
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
                                        if (!seenToolCalls.has(key)) {
                                            seenToolCalls.add(key);
                                            if (!activityStarted) { showActivityLog(); activityStarted = true; }
                                            addActivityItem('▸', 'running ' + name);
                                            updateThinkingLabel('running ' + name + '...');
                                        }
                                    }
                                }
                                if (m.role === 'tool' && m.name) {
                                    const key = 'result_' + m.name + '_' + (m.tool_call_id || '');
                                    if (!seenToolCalls.has(key)) {
                                        seenToolCalls.add(key);
                                        if (!activityStarted) { showActivityLog(); activityStarted = true; }
                                        addActivityItem('✓', m.name + ' done');
                                    }
                                }
                            }
                            if (seenToolCalls.size === 0 && pollCount > 1) {
                                updateThinkingLabel(activityLabels[Math.min(pollCount - 1, activityLabels.length - 1)]);
                            }
                        }
                    } catch {}
                    scrollToBottom();
                }, 2500);

                try {
                    const resp = await api('/api/sessions/' + activeSessionId + '/chat', {
                        method: 'POST',
                        body: JSON.stringify({ message: text }),
                        signal: abortController.signal,
                    });
                    clearInterval(pollInterval);
                    if (!resp.ok) {
                        const errText = await resp.text();
                        let errMsg;
                        try { errMsg = JSON.parse(errText).error?.message || errText; } catch { errMsg = errText; }
                        throw new Error(resp.status + ': ' + errMsg);
                    }
                    const fd = await resp.json();
                    fullContent = fd.message?.content || fd.content || '';
                } catch (pollErr) {
                    clearInterval(pollInterval);
                    throw pollErr;
                }
                if (!streamingOk) {
                    const msg = appendMessage('assistant', '', true);
                    bodyEl = msg.bodyEl;
                }
                bodyEl.innerHTML = renderMd(fullContent);
            }

            if (fullContent) {
                session.messages.push({ role: 'assistant', content: fullContent });
                session.updatedAt = Date.now();
            }

            bodyEl.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
            addCodeCopyButtons(bodyEl);
            scrollToBottom();

        } catch (err) {
            removeThinking();
            if (err.name === 'AbortError') {
                appendMessage('assistant', '*stopped*', false);
            } else {
                appendMessage('error', 'failed to connect: ' + err.message, false);
                session.messages.pop();
            }
        } finally {
            showStreamingUI(false);
            autoResize();
            messageInput.focus();
        }
    }

    function stopGeneration() { if (abortController) abortController.abort(); }

    function showStreamingUI(streaming) {
        isStreaming = streaming;
        sendBtn.style.display = streaming ? 'none' : 'flex';
        stopBtn.style.display = streaming ? 'flex' : 'none';
        sendBtn.disabled = true;
        messageInput.disabled = false;
        messageInput.placeholder = streaming ? 'hermes is working...' : '';
        if (streaming) showThinking();
    }

    // ── Thinking / Activity ──
    function showThinking(label) {
        removeThinking();
        thinkingEl = document.createElement('div');
        thinkingEl.className = 'thinking';
        thinkingEl.innerHTML = '<div class="thinking-inner">' +
            '<div class="thinking-dots"><span></span><span></span><span></span></div>' +
            '<span class="thinking-label">' + esc(label || 'thinking...') + '</span></div>';
        messagesEl.appendChild(thinkingEl);
        scrollToBottom();
    }

    function updateThinkingLabel(label) {
        if (!thinkingEl) return;
        const lbl = thinkingEl.querySelector('.thinking-label');
        if (lbl) lbl.textContent = label;
    }

    function removeThinking() {
        if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
        if (activityEl) { activityEl.remove(); activityEl = null; }
    }

    function showActivityLog() {
        if (activityEl) return;
        activityEl = document.createElement('div');
        activityEl.className = 'activity-log';
        if (thinkingEl) thinkingEl.after(activityEl);
        else messagesEl.appendChild(activityEl);
    }

    function addActivityItem(icon, text) {
        if (!activityEl) showActivityLog();
        const item = document.createElement('div');
        item.className = 'activity-item';
        const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        item.innerHTML = '<span class="activity-icon">' + icon + '</span>' +
            '<span class="activity-text">' + esc(text) + '</span>' +
            '<span class="activity-time">' + time + '</span>';
        activityEl.appendChild(item);
        scrollToBottom();
    }

    // ── Messages ──
    function appendMessage(role, content, streaming) {
        const div = document.createElement('div');
        div.className = 'msg ' + role;
        const label = role === 'user' ? 'you' : role === 'error' ? 'error' : 'hermes';
        div.innerHTML = '<div class="msg-header">' + label + '</div>' +
            '<div class="msg-body">' + (streaming ? '' : renderMd(content)) + '</div>';
        messagesEl.appendChild(div);
        scrollToBottom();
        const bodyEl = div.querySelector('.msg-body');
        if (!streaming && content) {
            bodyEl.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
            addCodeCopyButtons(bodyEl);
        }
        return { messageEl: div, bodyEl };
    }

    function renderMd(t) { if (!t) return ''; try { return marked.parse(t); } catch { return esc(t); } }

    function addCodeCopyButtons(container) {
        container.querySelectorAll('pre').forEach(pre => {
            if (pre.querySelector('.code-header')) return;
            const code = pre.querySelector('code');
            const lang = code?.className?.replace('language-', '') || '';
            const h = document.createElement('div');
            h.className = 'code-header';
            h.innerHTML = '<span>' + (lang || 'code') + '</span><button class="copy-btn">copy</button>';
            h.querySelector('.copy-btn').addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(code.textContent); h.querySelector('.copy-btn').textContent = 'copied!'; setTimeout(() => h.querySelector('.copy-btn').textContent = 'copy', 2000); } catch {}
            });
            pre.insertBefore(h, code);
        });
    }

    function scrollToBottom() { requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }); }
    function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    // ── Settings ──
    function openSettings() {
        $('#apiUrl').value = config.apiUrl || '';
        $('#apiKey').value = config.apiKey || '';
        $('#settingsModal').classList.add('active');
    }
    function closeSettings() { $('#settingsModal').classList.remove('active'); }
    function saveSettings() {
        config.apiUrl = $('#apiUrl').value.replace(/\/+$/, '') || (isLocal ? DEFAULT_API_URL : TUNNEL_URL);
        config.apiKey = $('#apiKey').value.trim() || DEFAULT_API_KEY;
        saveConfig();
        closeSettings();
        checkHealth();
        loadSessionsFromServer();
    }
})();
