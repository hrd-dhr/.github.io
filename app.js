/**
 * Urban Scientist Planner - Frontend Application
 * Document-style plan viewer with iterative refinement.
 */

// API endpoint
const API_BASE = "https://cruel-radios-talk.loca.lt";

// State
let currentConversationId = null;
let isStreaming = false;
let currentPlanContent = "";

// DOM Elements
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
const loadingOverlay = document.getElementById("loading-overlay");

// --- Event Listeners ---

generateBtn.addEventListener("click", handleGenerate);
sendFeedbackBtn.addEventListener("click", handleFeedback);
newPlanBtn.addEventListener("click", startNewPlan);
copyBtn.addEventListener("click", copyPlan);

// Auto-resize textareas
welcomeInput.addEventListener("input", autoResize);
feedbackInput.addEventListener("input", autoResize);

// Enter to submit
welcomeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleGenerate();
    }
});

feedbackInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isStreaming) {
        e.preventDefault();
        handleFeedback();
    }
});

// Enable/disable send button
feedbackInput.addEventListener("input", () => {
    sendFeedbackBtn.disabled = feedbackInput.value.trim() === "" || isStreaming;
});

// --- Core Functions ---

async function handleGenerate() {
    const content = welcomeInput.value.trim();
    if (!content || isStreaming) return;

    // Switch to plan view immediately
    showPlanView();
    setStatus("generating", "Generating...");
    loadingOverlay.classList.remove("hidden");
    copyBtn.classList.add("hidden");

    // Create conversation
    try {
        const response = await apiFetch(`${API_BASE}/api/conversations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) throw new Error("Failed to create conversation");

        const data = await response.json();
        currentConversationId = data.conversation_id;

        // Stream plan generation
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

    // Clear current content and start fresh
    planContentEl.innerHTML = "";
    currentPlanContent = "";
    streamingCursor.classList.remove("hidden");

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
                            currentPlanContent += decoded;
                            renderPlanContent();
                        } else if (currentEventType === "error") {
                            currentPlanContent += `\n\n[Error: ${decoded}]`;
                            renderPlanContent();
                        } else if (currentEventType === "done") {
                            currentPlanContent = decoded || currentPlanContent;
                            renderPlanContent();
                        }
                    } catch (e) {
                        // Skip invalid data
                    }
                }
            }
        }

        // Finalize
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

// --- UI Functions ---

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
        // Fallback
        const textarea = document.createElement("textarea");
        textarea.value = currentPlanContent;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
    }
}

// --- Markdown Rendering ---

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

    // Code blocks
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

    // Tables
    html = html.replace(/((?:^\|.+\n?)+)/gm, (match) => {
        const lines = match.trim().split('\n');
        if (lines.length < 2) return match;
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

    // Lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Paragraphs
    html = html.replace(
        /^(?!<)(.+)$/gm,
        (match) => {
            if (match.trim() === "") return "";
            return `<p>${match}</p>`;
        }
    );

    // Cleanup
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

function scrollToTop() {
    const container = planContentEl.closest('.plan-container');
    if (container) container.scrollTop = 0;
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Helper: fetch
function apiFetch(url, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...options.headers,
    };
    return fetch(url, { ...options, headers });
}

// Initialize
welcomeInput.focus();
