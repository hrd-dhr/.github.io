/**
 * Urban Scientist Planner - Frontend Application
 * Handles conversation flow, SSE streaming, and markdown rendering.
 */

// API endpoint — update this when the tunnel URL changes
// Current tunnel: https://little-carpets-follow.loca.lt
const API_BASE = "https://little-carpets-follow.loca.lt";

// State
let currentConversationId = null;
let isStreaming = false;
let inviteCode = localStorage.getItem("invite_code") || "";

// DOM Elements
const inviteScreen = document.getElementById("invite-screen");
const inviteInput = document.getElementById("invite-input");
const inviteSubmitBtn = document.getElementById("invite-submit-btn");
const inviteError = document.getElementById("invite-error");
const appContainer = document.getElementById("app-container");

const welcomeScreen = document.getElementById("welcome-screen");
const conversationView = document.getElementById("conversation-view");
const welcomeInput = document.getElementById("welcome-input");
const chatInput = document.getElementById("chat-input");
const generateBtn = document.getElementById("generate-btn");
const sendBtn = document.getElementById("send-btn");
const newConversationBtn = document.getElementById("new-conversation-btn");
const logoutBtn = document.getElementById("logout-btn");
const messagesContainer = document.getElementById("messages-container");
const loadingOverlay = document.getElementById("loading-overlay");

// --- Invite Code ---

inviteSubmitBtn.addEventListener("click", handleInviteSubmit);
inviteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        handleInviteSubmit();
    }
});

logoutBtn.addEventListener("click", handleLogout);

// Check if already has a valid invite code on load
if (inviteCode) {
    showApp();
} else {
    inviteInput.focus();
}

async function handleInviteSubmit() {
    const code = inviteInput.value.trim();
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
            inviteCode = code;
            localStorage.setItem("invite_code", code);
            showApp();
        } else {
            inviteError.classList.remove("hidden");
            inviteInput.value = "";
            inviteInput.focus();
        }
    } catch (error) {
        inviteError.textContent = "Connection error. Please try again.";
        inviteError.classList.remove("hidden");
    } finally {
        inviteSubmitBtn.disabled = false;
    }
}

function showApp() {
    inviteScreen.classList.add("hidden");
    appContainer.style.display = "flex";
    welcomeInput.focus();
}

function handleLogout() {
    if (isStreaming) return;
    localStorage.removeItem("invite_code");
    inviteCode = "";
    appContainer.style.display = "none";
    inviteScreen.classList.remove("hidden");
    inviteInput.value = "";
    inviteError.classList.add("hidden");
    inviteInput.focus();
    // Reset conversation
    currentConversationId = null;
    messagesContainer.innerHTML = "";
    conversationView.classList.add("hidden");
    welcomeScreen.style.display = "flex";
    welcomeInput.value = "";
}

// Helper: fetch with invite code header
function apiFetch(url, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        "X-Invite-Code": inviteCode,
        ...options.headers,
    };
    return fetch(url, { ...options, headers });
}

// --- Event Listeners ---

generateBtn.addEventListener("click", handleGenerate);
sendBtn.addEventListener("click", handleSend);
newConversationBtn.addEventListener("click", startNewConversation);

// Auto-resize textareas
welcomeInput.addEventListener("input", autoResize);
chatInput.addEventListener("input", autoResize);

// Enter to submit (Shift+Enter for newline)
welcomeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleGenerate();
    }
});

chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isStreaming) {
        e.preventDefault();
        handleSend();
    }
});

// Enable/disable send button
chatInput.addEventListener("input", () => {
    sendBtn.disabled = chatInput.value.trim() === "" || isStreaming;
});

// --- Core Functions ---

async function handleGenerate() {
    const content = welcomeInput.value.trim();
    if (!content || isStreaming) return;

    // Create conversation
    try {
        const response = await apiFetch(`${API_BASE}/api/conversations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) throw new Error("Failed to create conversation");

        const data = await response.json();
        currentConversationId = data.conversation_id;

        // Switch to conversation view
        showConversationView();

        // Send user message
        addUserMessage(content);

        // Clear input
        welcomeInput.value = "";
        welcomeInput.style.height = "auto";

        // Stream response
        await streamResponse(content);
    } catch (error) {
        showError(error.message);
    }
}

async function handleSend() {
    const content = chatInput.value.trim();
    if (!content || !currentConversationId || isStreaming) return;

    addUserMessage(content);
    chatInput.value = "";
    chatInput.style.height = "auto";
    sendBtn.disabled = true;

    await streamResponse(content);
}

async function streamResponse(userContent) {
    isStreaming = true;
    generateBtn.disabled = true;
    sendBtn.disabled = true;
    loadingOverlay.classList.remove("hidden");

    // Create a streaming message bubble
    const assistantBubble = addAssistantMessage("", true);

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
        let fullContent = "";
        let currentEventType = "";

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
                            updateStreamingMessage(assistantBubble, fullContent);
                        } else if (currentEventType === "error") {
                            fullContent += `\n[Error: ${decoded}]`;
                            updateStreamingMessage(assistantBubble, fullContent);
                        } else if (currentEventType === "done") {
                            updateStreamingMessage(assistantBubble, decoded || fullContent, false);
                        }
                    } catch (e) {
                        // Skip invalid data
                    }
                }
            }
        }

        // If we didn't get a "done" event, finalize anyway
        if (fullContent) {
            updateStreamingMessage(assistantBubble, fullContent, false);
        }
    } catch (error) {
        updateStreamingMessage(
            assistantBubble,
            fullContent + `\n\n[Connection error: ${error.message}]`,
            false
        );
        assistantBubble.messageEl.classList.add("error");
    } finally {
        isStreaming = false;
        generateBtn.disabled = false;
        sendBtn.disabled = chatInput.value.trim() === "";
        loadingOverlay.classList.add("hidden");
        scrollToBottom();
    }
}

// --- UI Functions ---

function showConversationView() {
    welcomeScreen.style.display = "none";
    conversationView.classList.remove("hidden");
    chatInput.placeholder = "Provide feedback on the plan...";
    chatInput.focus();
}

function addUserMessage(content) {
    const wrapper = document.createElement("div");
    wrapper.className = "message user";

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";
    contentEl.textContent = content;

    const timestamp = document.createElement("div");
    timestamp.className = "message-timestamp";
    timestamp.textContent = formatTime(new Date());

    const contentWrapper = document.createElement("div");
    contentWrapper.appendChild(contentEl);
    contentWrapper.appendChild(timestamp);

    wrapper.appendChild(contentWrapper);
    messagesContainer.appendChild(wrapper);
    scrollToBottom();
    return wrapper;
}

function addAssistantMessage(content = "", streaming = false) {
    const wrapper = document.createElement("div");
    wrapper.className = "message assistant";

    const contentWrapper = document.createElement("div");

    const role = document.createElement("div");
    role.className = "message-role";
    role.textContent = "Research Plan";

    const contentEl = document.createElement("div");
    contentEl.className = "message-content plan-content" + (streaming ? " streaming-cursor" : "");

    if (content) {
        contentEl.innerHTML = renderMarkdown(content);
    } else {
        contentEl.innerHTML = '<span class="text-muted">Generating...</span>';
    }

    const timestamp = document.createElement("div");
    timestamp.className = "message-timestamp";
    timestamp.textContent = formatTime(new Date());

    contentWrapper.appendChild(role);
    contentWrapper.appendChild(contentEl);
    contentWrapper.appendChild(timestamp);

    wrapper.appendChild(contentWrapper);
    messagesContainer.appendChild(wrapper);
    scrollToBottom();

    return { messageEl: wrapper, contentEl, roleEl: role, timestamp };
}

function updateStreamingMessage(assistantBubble, content, streaming = true) {
    if (!assistantBubble || !assistantBubble.contentEl) return;

    assistantBubble.contentEl.innerHTML = renderMarkdown(content);

    // Render math formulas with KaTeX
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(assistantBubble.contentEl, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
                {left: '\\(', right: '\\)', display: false},
                {left: '\\[', right: '\\]', display: true},
            ],
            throwOnError: false,
        });
    }

    if (streaming) {
        assistantBubble.contentEl.classList.add("streaming-cursor");
    } else {
        assistantBubble.contentEl.classList.remove("streaming-cursor");
    }

    scrollToBottom();
}

function showError(message) {
    const wrapper = document.createElement("div");
    wrapper.className = "message assistant error";

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";
    contentEl.textContent = `Error: ${message}`;

    wrapper.appendChild(contentEl);
    messagesContainer.appendChild(wrapper);
    scrollToBottom();
}

// --- Markdown Rendering ---

function parseTableRow(line) {
    // Remove leading/trailing |, then split by |
    line = line.replace(/^\||\|$/g, '').trim();
    return line.split('|').map(c => c.trim());
}

function renderInlineMarkdown(text) {
    // Lightweight inline-only rendering for table cells
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

    // Code blocks (``` ... ```)
    html = html.replace(
        /```(\w*)\n([\s\S]*?)```/g,
        (_, lang, code) => `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headings
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold + Italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^\*\*\*$/gm, '<hr>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Markdown tables: find consecutive | lines and convert to <table>
    html = html.replace(/((?:^\|.+\n?)+)/gm, (match) => {
        const lines = match.trim().split('\n');
        if (lines.length < 2) return match;

        // Check if it's a valid table (line 1 has |, line 2 is separator with ---)
        if (!lines[1].match(/^\|?[\s\-:|]+\|?$/)) return match;

        const headerCells = parseTableRow(lines[0]);
        let tableHtml = '<table class="md-table"><thead><tr>';
        headerCells.forEach(cell => {
            tableHtml += `<th>${renderInlineMarkdown(cell)}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';

        for (let i = 2; i < lines.length; i++) {
            if (lines[i].trim() === '') continue;
            const cells = parseTableRow(lines[i]);
            tableHtml += '<tr>';
            cells.forEach(cell => {
                tableHtml += `<td>${renderInlineMarkdown(cell)}</td>`;
            });
            tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table>';
        return tableHtml;
    });

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Wrap consecutive <li> in <ul>
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Paragraphs: wrap lines that aren't already in HTML tags
    html = html.replace(
        /^(?!<)(.+)$/gm,
        (match) => {
            // Skip if it's already wrapped in a block element
            if (match.trim() === "") return "";
            return `<p>${match}</p>`;
        }
    );

    // Clean up extra newlines
    html = html.replace(/\n{2,}/g, "");
    html = html.replace(/<\/ul>\s*<ul>/g, "");

    return html;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// --- Utilities ---

function decodeBase64(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

function autoResize(e) {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function startNewConversation() {
    if (isStreaming) return;

    currentConversationId = null;
    messagesContainer.innerHTML = "";
    conversationView.classList.add("hidden");
    welcomeScreen.style.display = "flex";
    chatInput.value = "";
    welcomeInput.value = "";
    welcomeInput.style.height = "auto";
    welcomeInput.focus();
}

// Initialize
welcomeInput.focus();
