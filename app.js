/**
 * Urban Scientist Planner - Frontend Application
 * Document-style plan viewer with iterative refinement.
 */

// API endpoint — auto-detect: same-origin for localhost, tunnel URL for GitHub Pages.
// The DEPLOY_API_BASE is injected by restart-tunnel.sh for remote access only.
const DEPLOY_API_BASE = "https://slimy-berries-punch.loca.lt";
const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? ""
    : DEPLOY_API_BASE;

// Invite codes shown on the banner
const SHOW_CODES = ["XURB-7F2A-9DC4-E831", "PLAN-4E19-8BA2-CF67", "SCI-3B06-A0C9-438A"];

// State
let currentConversationId = null;
let isStreaming = false;
let currentPlanContent = "";
let isAuthenticated = localStorage.getItem("invite_code") ? true : false;
let storedCode = localStorage.getItem("invite_code") || "";

// DOM Elements
const inviteBanner = document.getElementById("invite-banner");
const inviteInput = document.getElementById("invite-input");
const inviteSubmitBtn = document.getElementById("invite-submit-btn");
const inviteError = document.getElementById("invite-error");
const inviteCodeDisplay = document.getElementById("invite-code-display");
const authStatus = document.getElementById("auth-status");
const welcomeScreen = document.getElementById("welcome-screen");
const mainContent = document.querySelector(".main-content");
const planView = document.getElementById("plan-view");
const planContentEl = document.getElementById("plan-content");
const streamingCursor = document.getElementById("streaming-cursor");
const welcomeInput = document.getElementById("welcome-input");
const feedbackInput = document.getElementById("feedback-input");
const generateBtn = document.getElementById("generate-btn");
const sendFeedbackBtn = document.getElementById("send-feedback-btn");
const newPlanBtn = document.getElementById("new-plan-btn");
const copyBtn = document.getElementById("copy-btn");
const planStatus = document.getElementById("plan-status");
const logoutBtn = document.getElementById("logout-btn");
const loadingOverlay = document.getElementById("loading-overlay");

// --- Invite Code Display ---
inviteCodeDisplay.textContent = SHOW_CODES.join(" / ");
inviteCodeDisplay.addEventListener("click", () => {
    const currentIdx = inviteCodeDisplay.dataset.idx || "0";
    const nextIdx = (parseInt(currentIdx) + 1) % SHOW_CODES.length;
    inviteCodeDisplay.textContent = SHOW_CODES[nextIdx];
    inviteCodeDisplay.dataset.idx = String(nextIdx);
    navigator.clipboard?.writeText(SHOW_CODES[nextIdx]);
    inviteCodeDisplay.title = "Copied!";
    setTimeout(() => { inviteCodeDisplay.title = ""; }, 1000);
});

// --- Invite Banner ---
inviteSubmitBtn.addEventListener("click", handleInviteSubmit);
inviteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleInviteSubmit(); }
});
logoutBtn.addEventListener("click", handleLock);

if (isAuthenticated) {
    verifyStoredCode();
} else {
    inviteInput.focus();
    setLockedState(true);
}

async function verifyStoredCode() {
    try {
        const response = await fetch(`${API_BASE}/api/invite/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: storedCode }),
        });
        const data = await response.json();
        if (data.valid) {
            setLockedState(false);
        } else {
            localStorage.removeItem("invite_code");
            isAuthenticated = false;
            storedCode = "";
            inviteInput.value = "";
            inviteInput.focus();
            setLockedState(true);
        }
    } catch {
        setLockedState(false);
    }
}

async function handleInviteSubmit() {
    const code = inviteInput.value.trim().toUpperCase();
    if (!code) return;

    inviteSubmitBtn.disabled = true;
    inviteError.classList.add("hidden");

    try {
        const response = await fetch(`${API_BASE}/api/invite/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
        });
        const data = await response.json();

        if (data.valid) {
            storedCode = code;
            isAuthenticated = true;
            localStorage.setItem("invite_code", code);
            inviteBanner.classList.add("hidden");
            setLockedState(false);
        } else {
            inviteError.classList.remove("hidden");
            inviteInput.value = "";
            inviteInput.focus();
        }
    } catch (error) {
        inviteError.textContent = "Connection error";
        inviteError.classList.remove("hidden");
    } finally {
        inviteSubmitBtn.disabled = false;
    }
}

function setLockedState(locked) {
    welcomeInput.disabled = locked;
    feedbackInput.disabled = locked;
    generateBtn.disabled = locked;
    sendFeedbackBtn.disabled = true;

    if (locked) {
        authStatus.classList.remove("authenticated");
        authStatus.querySelector(".status-text").textContent = "Locked";
        authStatus.title = "Enter invite code to unlock";
        mainContent.classList.add("locked");
    } else {
        authStatus.classList.add("authenticated");
        authStatus.querySelector(".status-text").textContent = "Unlocked";
        authStatus.title = "Authenticated";
        mainContent.classList.remove("locked");
        welcomeInput.focus();
    }
}

function handleLock() {
    if (isStreaming) return;
    localStorage.removeItem("invite_code");
    isAuthenticated = false;
    storedCode = "";
    inviteInput.value = "";
    inviteError.classList.add("hidden");
    inviteBanner.classList.remove("hidden");
    inviteInput.focus();
    setLockedState(true);
    currentConversationId = null;
    currentPlanContent = "";
    planContentEl.innerHTML = "";
    planView.classList.add("hidden");
    welcomeScreen.style.display = "flex";
    copyBtn.classList.add("hidden");
    setStatus("", "");
}

function apiFetch(url, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        "X-Invite-Code": storedCode,
        ...options.headers,
    };
    return fetch(url, { ...options, headers });
}

// --- Event Listeners ---

generateBtn.addEventListener("click", handleGenerate);
sendFeedbackBtn.addEventListener("click", handleFeedback);
newPlanBtn.addEventListener("click", startNewPlan);
copyBtn.addEventListener("click", copyPlan);

welcomeInput.addEventListener("input", autoResize);
feedbackInput.addEventListener("input", autoResize);

welcomeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
});
feedbackInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isStreaming) { e.preventDefault(); handleFeedback(); }
});
feedbackInput.addEventListener("input", () => {
    sendFeedbackBtn.disabled = feedbackInput.value.trim() === "" || isStreaming;
});

async function handleGenerate() {
    const content = welcomeInput.value.trim();
    if (!content || isStreaming) return;

    showPlanView();
    setStatus("generating", "Generating...");
    loadingOverlay.classList.remove("hidden");
    copyBtn.classList.add("hidden");

    try {
        const response = await apiFetch(`${API_BASE}/api/conversations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) throw new Error("Failed to create conversation");

        const data = await response.json();
        currentConversationId = data.conversation_id;

        await streamPlan(content);
    } catch (error) {
        planContentEl.innerHTML = `<p style="color: var(--error);">Error: ${error.message}</p>`;
        setStatus("", "Error");
        loadingOverlay.classList.add("hidden");
        isStreaming = false;
    }
}

async function handleFeedback() {
    const content = feedbackInput.value.trim();
    if (!content || !currentConversationId || isStreaming) return;

    isStreaming = true;
    setStatus("generating", "Refining...");
    feedbackInput.value = "";
    feedbackInput.style.height = "auto";
    sendFeedbackBtn.disabled = true;
    streamingCursor.classList.remove("hidden");

    try {
        await streamPlan(content);
    } catch (error) {
        setStatus("complete", "Error");
        isStreaming = false;
    }
}

async function streamPlan(userContent) {
    isStreaming = true;
    generateBtn.disabled = true;
    sendFeedbackBtn.disabled = true;

    planContentEl.innerHTML = "";
    currentPlanContent = "";
    streamingCursor.classList.remove("hidden");

    let fullContent = "";
    let currentEventType = "";

    try {
        const response = await apiFetch(
            `${API_BASE}/api/conversations/${currentConversationId}/message`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: userContent }),
            }
        );

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (line.startsWith("event: ")) {
                    currentEventType = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                    try {
                        const encoded = line.slice(6).trim();
                        const decoded = decodeBase64(encoded);
                        if (currentEventType === "chunk") {
                            fullContent += decoded;
                            currentPlanContent += decoded;
                            renderPlanContent();
                        } else if (currentEventType === "error") {
                            currentPlanContent += `\n\n[Error: ${decoded}]`;
                            renderPlanContent();
                        } else if (currentEventType === "done") {
                            currentPlanContent = decoded || currentPlanContent;
                            renderPlanContent();
                        }
                    } catch (e) { /* Skip invalid data */ }
                }
            }
        }

        if (currentPlanContent) {
            renderPlanContent();
        }
    } catch (error) {
        planContentEl.innerHTML = `<p style="color: var(--error);">Connection error: ${error.message}</p>`;
    } finally {
        isStreaming = false;
        generateBtn.disabled = false;
        sendFeedbackBtn.disabled = feedbackInput.value.trim() === "";
        loadingOverlay.classList.add("hidden");
        streamingCursor.classList.add("hidden");
        setStatus("complete", "Complete");
        copyBtn.classList.remove("hidden");
        scrollToTop();
    }
}

function renderPlanContent() {
    planContentEl.innerHTML = renderMarkdown(currentPlanContent);
    renderMath();
}

function renderMath() {
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(planContentEl, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
                {left: '\\(', right: '\\)', display: false},
                {left: '\\[', right: '\\]', display: true},
            ],
            throwOnError: false,
        });
    }
}

function showPlanView() {
    welcomeScreen.style.display = "none";
    planView.classList.remove("hidden");
    feedbackInput.focus();
}

function setStatus(type, text) {
    if (type) {
        planStatus.classList.remove("hidden", "generating", "complete");
        planStatus.classList.add(type);
    } else {
        planStatus.classList.add("hidden");
    }
    planStatus.querySelector(".status-text").textContent = text;
}

function startNewPlan() {
    if (isStreaming) return;

    currentConversationId = null;
    currentPlanContent = "";
    planContentEl.innerHTML = "";
    planView.classList.add("hidden");
    welcomeScreen.style.display = "flex";
    feedbackInput.value = "";
    welcomeInput.value = "";
    welcomeInput.style.height = "auto";
    welcomeInput.focus();
    copyBtn.classList.add("hidden");
    setStatus("", "");
}

async function copyPlan() {
    if (!currentPlanContent) return;
    try {
        await navigator.clipboard.writeText(currentPlanContent);
        const origText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
        setTimeout(() => { copyBtn.innerHTML = origText; }, 2000);
    } catch (e) {
        const textarea = document.createElement("textarea");
        textarea.value = currentPlanContent;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
    }
}

function parseTableRow(line) {
    line = line.replace(/^\||\|$/g, '').trim();
    return line.split('|').map(c => c.trim());
}

function renderInlineMarkdown(text) {
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    return text;
}

function renderMarkdown(text) {
    if (!text) return "";
    let html = text;
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^\*\*\*$/gm, '<hr>');
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/((?:^\|.+\n?)+)/gm, (match) => {
        const lines = match.trim().split('\n');
        if (lines.length < 2) return match;
        if (!lines[1].match(/^\|?[\s\-:|]+\|?$/)) return match;
        const headerCells = parseTableRow(lines[0]);
        let tableHtml = '<table class="md-table"><thead><tr>';
        headerCells.forEach(cell => { tableHtml += `<th>${renderInlineMarkdown(cell)}</th>`; });
        tableHtml += '</tr></thead><tbody>';
        for (let i = 2; i < lines.length; i++) {
            if (lines[i].trim() === '') continue;
            const cells = parseTableRow(lines[i]);
            tableHtml += '<tr>';
            cells.forEach(cell => { tableHtml += `<td>${renderInlineMarkdown(cell)}</td>`; });
            tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table>';
        return tableHtml;
    });
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/^(?!<)(.+)$/gm, (match) => { if (match.trim() === "") return ""; return `<p>${match}</p>`; });
    html = html.replace(/\n{2,}/g, "");
    html = html.replace(/<\/ul>\s*<ul>/g, "");
    return html;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function decodeBase64(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
    return new TextDecoder().decode(bytes);
}

function autoResize(e) {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
}

function scrollToTop() {
    const container = planContentEl.closest('.plan-container');
    if (container) container.scrollTop = 0;
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

welcomeInput.focus();
