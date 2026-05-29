// ── Hermes Chat UI v5 ──
(() => {
    'use strict';

    const DEFAULT_API_URL = 'http://localhost:8642';
    const TUNNEL_URL = 'https://installing-ultram-ballet-lenders.trycloudflare.com';
    const DEFAULT_API_KEY='bzJg4-OgW2sP13g8G7uAeEAkt7KciUGu6BQUq-_VZcw';
    const STORAGE_KEY = 'hermes-chat-config-v8';

    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
                     (innerWidth <= 768 && 'ontouchstart' in window);

    let config = loadConfig();
    let sessions = {};
    let activeSessionId = null;
    let isStreaming = false;
    let abortController = null;
    let thinkingEl = null;
    let activityEl = null;
    let cmdSelected = -1;

    // ── Slash Commands ──
    const COMMANDS = [
        { name: '/new', desc: 'Start a new conversation', icon: '✨', action: 'newChat' },
        { name: '/clear', desc: 'Clear screen and start fresh', icon: '🧹', action: 'newChat' },
        { name: '/sessions', desc: 'Show all conversations', icon: '📋', action: 'showSessions' },
        { name: '/settings', desc: 'Open settings', icon: '⚙️', action: 'openSettingsCmd' },
        { name: '/stop', desc: 'Stop the current response', icon: '⏹️', action: 'stopGeneration' },
        { name: '/help', desc: 'Show available commands', icon: '❓', action: 'showHelp' },
    ];

    const $ = s => document.querySelector(s);
    const welcomeScreen = $('#welcomeScreen');
    const messagesEl = $('#messages');
    const messageInput = $('#messageInput');
    const sendBtn = $('#sendBtn');
    const stopBtn = $('#stopBtn');
    const sessionList = $('#sessionList');
    const connectionStatus = $('#connectionStatus');
    const settingsModal = $('#settingsModal');
    const sidebar = $('#sidebar');
    const inputHint = $('#inputHint');
    const cmdPalette = $('#cmdPalette');

    marked.setOptions({
        highlight: (code, lang) => {
            if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
            return hljs.highlightAuto(code).value;
        },
        breaks: true, gfm: true,
    });

    // ── Lock Screen ──
    const LOCK_PASSWORD = 'Lantz_040405';
    const lockScreen = $('#lockScreen');
    const lockForm = $('#lockForm');
    const lockPassword = $('#lockPassword');
    const lockError = $('#lockError');
    const mainApp = $('#mainApp');

    function unlockApp() {
        lockScreen.classList.add('hidden');
        mainApp.style.display = '';
        messageInput.focus();
    }

    // Check if already unlocked this session
    if (sessionStorage.getItem('hermes-unlocked') === 'true') {
        unlockApp();
    }

    lockForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (lockPassword.value === LOCK_PASSWORD) {
            lockError.textContent = '';
            sessionStorage.setItem('hermes-unlocked', 'true');
            unlockApp();
        } else {
            lockError.textContent = 'Wrong password. Try again.';
            lockPassword.value = '';
            lockPassword.focus();
        }
    });

    // ── Init ──
    setupMobileUX();
    checkHealth();
    loadSessionsFromServer();
    messageInput.focus();
    setInterval(checkHealth, 30000);

    // ── Events ──
    messageInput.addEventListener('input', onInput);
    messageInput.addEventListener('keydown', handleInputKeydown);
    sendBtn.addEventListener('click', sendMessage);
    stopBtn.addEventListener('click', stopGeneration);
    $('#newChatBtn').addEventListener('click', newChat);
    $('#settingsBtn').addEventListener('click', openSettingsCmd);
    $('#closeSettingsBtn').addEventListener('click', closeSettings);
    $('#cancelSettingsBtn').addEventListener('click', closeSettings);
    $('#saveSettingsBtn').addEventListener('click', saveSettings);
    $('#mobileToggle').addEventListener('click', () => sidebar.classList.toggle('open'));

    document.querySelectorAll('.hint-chip').forEach(c => {
        c.addEventListener('click', () => {
            messageInput.value = c.dataset.prompt;
            autoResize();
            sendMessage();
        });
    });

    settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });

    document.addEventListener('click', e => {
        if (isMobile && sidebar.classList.contains('open') &&
            !sidebar.contains(e.target) && !$('#mobileToggle').contains(e.target)) {
            sidebar.classList.remove('open');
        }
        if (!cmdPalette.contains(e.target) && e.target !== messageInput) {
            closeCmdPalette();
        }
    });

    // ── Input handling ──

    function onInput() {
        autoResize();
        const val = messageInput.value;
        if (val === '/') {
            openCmdPalette('');
        } else if (val.startsWith('/')) {
            openCmdPalette(val);
        } else {
            closeCmdPalette();
        }
    }

    function setupMobileUX() {
        inputHint.textContent = isMobile ? 'Send button to send · Return for new line' : 'Enter to send · Shift+Enter for newline';
        let last = 0;
        document.addEventListener('touchend', e => {
            const now = Date.now();
            if (now - last <= 300) e.preventDefault();
            last = now;
        }, { passive: false });
    }

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
        return { apiUrl: isLocal ? DEFAULT_API_URL : TUNNEL_URL, apiKey: DEFAULT_API_KEY, sessionId: '' };
    }

    function saveConfig() { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); }

    function getApiUrl() { return (config.apiUrl || (isLocal ? DEFAULT_API_URL : TUNNEL_URL)).replace(/\\/+$/, ''); }

    async function api(path, opts = {}) {
        const headers = { 'Content-Type': 'application/json', ...opts.headers };
        if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;
        return fetch(getApiUrl() + path, { ...opts, headers });
    }

    // ── Server Sessions ──

    async function loadSessionsFromServer() {
        try {
            const r = await api('/api/sessions');
            if (!r.ok) throw new Error(r.status);
            const d = await r.json();
            const list = d.data || [];
            sessions = {};
            for (const s of list) {
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

    // ── Command Palette ──

    function openCmdPalette(query) {
        const q = query.replace(/^\//, '').toLowerCase();
        const filtered = COMMANDS.filter(c => c.name.toLowerCase().includes('/' + q) || c.desc.toLowerCase().includes(q));
        if (filtered.length === 0) { closeCmdPalette(); return; }

        cmdPalette.innerHTML = '<div class="cmd-palette-header">Commands</div>' +
            filtered.map((c, i) =>
                '<div class="cmd-item' + (i === 0 ? ' selected' : '') + '" data-action="' + c.action + '" data-idx="' + i + '">' +
                '<span class="cmd-item-icon">' + c.icon + '</span>' +
                '<div class="cmd-item-info"><div class="cmd-item-name">' + c.name + '</div>' +
                '<div class="cmd-item-desc">' + c.desc + '</div></div></div>'
            ).join('');

        cmdPalette.classList.add('active');
        cmdSelected = 0;

        cmdPalette.querySelectorAll('.cmd-item').forEach(el => {
            el.addEventListener('click', () => {
                const action = el.dataset.action;
                closeCmdPalette();
                messageInput.value = '';
                autoResize();
                if (typeof window[action] === 'function') window[action]();
            });
        });
    }

    function closeCmdPalette() {
        cmdPalette.classList.remove('active');
        cmdSelected = -1;
    }

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
            const action = el.dataset.action;
            closeCmdPalette();
            messageInput.value = '';
            autoResize();
            if (typeof window[action] === 'function') window[action]();
        }
    }

    // ── Keyboard ──

    function handleInputKeydown(e) {
        // Command palette navigation
        if (cmdPalette.classList.contains('active')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); navigateCmd(1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); navigateCmd(-1); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectCmd(); return; }
            if (e.key === 'Escape') { closeCmdPalette(); return; }
        }

        if (isMobile) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isStreaming && messageInput.value.trim()) sendMessage();
        }
    }

    // Expose for command palette
    window.newChat = newChat;
    window.showSessions = () => { sidebar.classList.add('open'); };
    window.openSettingsCmd = openSettingsCmd;
    window.stopGeneration = stopGeneration;
    window.showHelp = () => {
        messageInput.value = '';
        closeCmdPalette();
        appendMessage('assistant',
            '**Available commands:**\n\n' +
            COMMANDS.map(c => '- ' + c.icon + ' **' + c.name + '** — ' + c.desc).join('\n') +
            '\n\nYou can also just type anything to chat!', false);
    };

    // ── UI Functions ──

    function checkHealth() {
        const dot = connectionStatus.querySelector('.status-dot');
        const txt = connectionStatus.querySelector('.status-text');
        api('/health').then(r => {
            dot.className = r.ok ? 'status-dot connected' : 'status-dot error';
            txt.textContent = r.ok ? 'Connected' : 'Error';
        }).catch(() => { dot.className = 'status-dot error'; txt.textContent = 'Offline'; });
    }

    function autoResize() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
        sendBtn.disabled = !messageInput.value.trim() || isStreaming;
    }

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
        sidebar.classList.remove('open');
    }

    function renderSessionList() {
        const sorted = Object.values(sessions).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
        if (sorted.length === 0) { sessionList.innerHTML = '<div class="session-empty">No conversations yet</div>'; return; }
        sessionList.innerHTML = sorted.map(s => {
            const d = new Date(s.updatedAt || s.createdAt);
            const t = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return '<div class="session-item ' + (s.id === activeSessionId ? 'active' : '') + '" data-id="' + s.id + '">' +
                '<span class="session-title">' + esc(s.title) + '</span>' +
                '<span class="session-time">' + t + '</span>' +
                '<button class="session-delete" data-id="' + s.id + '">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
        }).join('');
        sessionList.querySelectorAll('.session-item').forEach(el => {
            el.addEventListener('click', e => { if (!e.target.closest('.session-delete')) switchToSession(el.dataset.id); });
        });
        sessionList.querySelectorAll('.session-delete').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); deleteSession(btn.dataset.id); });
        });
    }

    async function deleteSession(id) {
        try { await api('/api/sessions/' + id, { method: 'DELETE' }); } catch {}
        delete sessions[id];
        if (activeSessionId === id) newChat(); else renderSessionList();
    }

    // ── Streaming with activity log ──

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
        appendMessage('user', text);

        messageInput.value = '';
        autoResize();
        showStreamingUI(true);

        try {
            abortController = new AbortController();

            // Use streaming endpoint for real-time activity
            const resp = await api('/api/sessions/' + activeSessionId + '/chat/stream', {
                method: 'POST',
                body: JSON.stringify({ message: text, stream: true }),
                signal: abortController.signal,
            });

            if (!resp.ok) {
                const errText = await resp.text();
                let errMsg;
                try { errMsg = JSON.parse(errText).error?.message || errText; } catch { errMsg = errText; }
                throw new Error(resp.status + ': ' + errMsg);
            }

            removeThinking();
            const { bodyEl } = appendMessage('assistant', '', true);
            let fullContent = '';
            let activityStarted = false;

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

                        // Show tool calls as activity and update thinking label
                        if (parsed.type === 'tool_call' || parsed.tool_calls) {
                            const toolName = parsed.name || parsed.tool_calls?.[0]?.function?.name || 'tool';
                            if (!activityStarted) { showActivityLog(); activityStarted = true; }
                            addActivityItem('🔧', 'Calling ' + toolName + '...');
                            updateThinkingLabel('Calling ' + toolName + '...');
                        }
                        if (parsed.type === 'tool_result') {
                            const toolName = parsed.name || 'tool';
                            if (!activityStarted) { showActivityLog(); activityStarted = true; }
                            addActivityItem('✅', toolName + ' done');
                            updateThinkingLabel('Processing results...');
                        }

                        // Detect thinking/reasoning events
                        if (parsed.type === 'thinking' || parsed.type === 'reasoning') {
                            updateThinkingLabel('Thinking...');
                        }

                        // Content delta
                        const delta = parsed.choices?.[0]?.delta;
                        if (delta?.content) {
                            fullContent += delta.content;
                            if (fullContent.length === delta.content.length) updateThinkingLabel('Hermes is responding...');
                            bodyEl.innerHTML = renderMd(fullContent);
                        }

                        // Hermes session chat format
                        if (parsed.type === 'content' && parsed.content) {
                            fullContent += parsed.content;
                            if (fullContent.length === parsed.content.length) updateThinkingLabel('Hermes is responding...');
                            bodyEl.innerHTML = renderMd(fullContent);
                        }
                        if (parsed.type === 'text' && parsed.text) {
                            fullContent += parsed.text;
                            if (fullContent.length === parsed.text.length) updateThinkingLabel('Hermes is responding...');
                            bodyEl.innerHTML = renderMd(fullContent);
                        }

                        // Final message
                        if (parsed.message?.content && !fullContent) {
                            fullContent = parsed.message.content;
                            bodyEl.innerHTML = renderMd(fullContent);
                        }

                    } catch {}
                }
                scrollToBottom();
            }

            // If no streaming content, try non-streaming fallback
            if (!fullContent) {
                try {
                    const fallback = await api('/api/sessions/' + activeSessionId + '/chat', {
                        method: 'POST',
                        body: JSON.stringify({ message: text }),
                    });
                    const fd = await fallback.json();
                    fullContent = fd.message?.content || fd.content || 'No response.';
                    bodyEl.innerHTML = renderMd(fullContent);
                } catch {}
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
                appendMessage('assistant', '*Stopped.*');
            } else {
                appendMessage('error', 'Failed to connect: ' + err.message);
                session.messages.pop();
            }
        } finally {
            showStreamingUI(false);
            autoResize();
            messageInput.focus();
        }
    }

    function stopGeneration() {
        if (abortController) abortController.abort();
    }

    function showStreamingUI(streaming) {
        isStreaming = streaming;
        sendBtn.style.display = streaming ? 'none' : 'flex';
        stopBtn.style.display = streaming ? 'flex' : 'none';
        sendBtn.disabled = true;
        // Keep input enabled so user can type while Hermes works
        messageInput.disabled = false;
        messageInput.placeholder = streaming ? 'Hermes is working... type to queue a message' : 'Message Hermes... (type / for commands)';
        if (streaming) showThinking();
    }

    function showThinking(label) {
        removeThinking();
        thinkingEl = document.createElement('div');
        thinkingEl.className = 'thinking';
        thinkingEl.innerHTML = '<div class="thinking-inner">' +
            '<div class="thinking-dots"><span></span><span></span><span></span></div>' +
            '<span class="thinking-label">' + esc(label || 'Hermes is thinking...') + '</span></div>';
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
        div.className = 'message ' + role;
        const av = role === 'user' ? '👤' : role === 'error' ? '⚠' : '⚕';
        const nm = role === 'user' ? 'You' : role === 'error' ? 'Error' : 'Hermes';
        div.innerHTML = '<div class="message-inner"><div class="message-avatar">' + av + '</div>' +
            '<div class="message-content"><div class="message-role">' + nm + '</div>' +
            '<div class="message-body">' + (streaming ? '' : renderMd(content)) + '</div></div></div>';
        messagesEl.appendChild(div);
        scrollToBottom();
        const bodyEl = div.querySelector('.message-body');
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
            h.innerHTML = '<span>' + (lang || 'code') + '</span><button class="copy-btn">Copy</button>';
            h.querySelector('.copy-btn').addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(code.textContent); h.querySelector('.copy-btn').textContent = 'Copied!'; setTimeout(() => h.querySelector('.copy-btn').textContent = 'Copy', 2000); } catch {}
            });
            pre.insertBefore(h, code);
        });
    }

    function scrollToBottom() { requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }); }
    function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    function openSettingsCmd() {
        $('#apiUrl').value = config.apiUrl || '';
        $('#apiKey').value = config.apiKey || '';
        $('#sessionId').value = config.sessionId || '';
        settingsModal.classList.add('active');
        closeCmdPalette();
    }
    function closeSettings() { settingsModal.classList.remove('active'); }
    function saveSettings() {
        config.apiUrl = $('#apiUrl').value.replace(/\/+$/, '') || (isLocal ? DEFAULT_API_URL : TUNNEL_URL);
        config.apiKey = $('#apiKey').value.trim() || DEFAULT_API_KEY;
        config.sessionId = $('#sessionId').value.trim();
        saveConfig(); closeSettings(); checkHealth(); loadSessionsFromServer();
    }
})();
