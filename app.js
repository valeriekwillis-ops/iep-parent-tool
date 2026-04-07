/**
 * IEP Parent Tool — Main Application Controller
 * Manages views, state, and coordinates all modules.
 */

import { Storage } from './storage.js';
import { initLegalKB } from './legal-search.js';
import * as Chat from './chat.js';
import * as Transcription from './transcription.js';
import * as Documents from './documents.js';

// ---- State ----
let currentView = 'welcome'; // welcome, setup, main
let isRecording = false;
let interimElement = null;
let transcriptLines = 0;

// ---- Initialization ----
window.addEventListener('DOMContentLoaded', async () => {
    // Load legal KB in background
    initLegalKB().catch(e => console.error('Failed to load legal KB:', e));

    // Set up transcription callbacks
    Transcription.onFragment(handleTranscriptFragment);
    Transcription.onStatus(handleTranscriptStatus);

    // Check if setup is already complete
    if (Storage.isSetupComplete()) {
        showView('main');
        loadChatHistory();
    } else {
        showView('welcome');
    }

    // Set up mobile tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const pane = btn.dataset.pane;
            document.getElementById('transcriptPane').classList.toggle('pane-hidden', pane !== 'transcript');
            document.getElementById('chatPane').classList.toggle('pane-hidden', pane !== 'chat');
        });
    });
});

// ---- View Management ----
function showView(view) {
    currentView = view;
    document.getElementById('welcomeView').classList.toggle('hidden', view !== 'welcome');
    document.getElementById('setupView').classList.toggle('hidden', view !== 'setup');
    document.getElementById('mainView').classList.toggle('hidden', view !== 'main');
}

// Expose to HTML onclick
window.showView = showView;

// ---- Welcome & Setup ----
window.startSetup = function () {
    showView('setup');
};

window.testApiKey = async function () {
    const input = document.getElementById('apiKeyInput');
    const status = document.getElementById('keyTestStatus');
    const key = input.value.trim();

    if (!key) {
        status.textContent = 'Please enter an API key.';
        status.className = 'status-msg error';
        return;
    }

    status.textContent = 'Testing connection...';
    status.className = 'status-msg';

    const result = await Chat.testConnection(key);
    if (result.ok) {
        Storage.setApiKey(key);
        status.textContent = 'Connected successfully!';
        status.className = 'status-msg success';
        document.getElementById('finishSetupBtn').disabled = false;
    } else {
        status.textContent = result.error;
        status.className = 'status-msg error';
    }
};

window.finishSetup = function () {
    // Save optional child info
    const childInfo = {
        name: document.getElementById('childName').value.trim(),
        district: document.getElementById('childDistrict').value.trim(),
        grade: document.getElementById('childGrade').value.trim(),
        disabilities: document.getElementById('childDisabilities').value.trim(),
    };
    Storage.setChildInfo(childInfo);
    Storage.completeSetup();
    showView('main');
};

// ---- Chat ----
window.sendQuestion = async function () {
    const input = document.getElementById('questionInput');
    const question = input.value.trim();
    if (!question) return;

    input.value = '';
    input.focus();

    // Add user message
    addChatMessage('user', question);
    Storage.addChatMessage({ role: 'user', content: question });

    // Create assistant placeholder
    const assistantDiv = addChatMessage('assistant', '');
    const contentEl = assistantDiv.querySelector('.message-content');
    contentEl.innerHTML = '<span class="loading"></span> Thinking...';

    let fullResponse = '';
    let sources = null;

    try {
        for await (const event of Chat.sendMessage(question, isRecording)) {
            if (event.type === 'sources') {
                sources = event.data;
            } else if (event.type === 'text') {
                if (contentEl.querySelector('.loading')) contentEl.textContent = '';
                fullResponse += event.data;
                contentEl.textContent = fullResponse;
                // Auto-scroll
                const chatContent = document.getElementById('chatContent');
                chatContent.scrollTop = chatContent.scrollHeight;
            } else if (event.type === 'error') {
                contentEl.textContent = event.data;
                contentEl.classList.add('error-text');
            } else if (event.type === 'done') {
                // Add sources
                if (sources) {
                    const sourcesEl = document.createElement('div');
                    sourcesEl.className = 'sources';
                    let html = 'Sources: ';
                    for (const s of (sources.legal || [])) {
                        if (s.citation) html += `<span>${esc(s.citation)}</span> `;
                        else if (s.source) html += `<span>${esc(s.source)}</span> `;
                    }
                    for (const s of (sources.documents || [])) {
                        if (s.source) html += `<span>${esc(s.source)}</span> `;
                    }
                    sourcesEl.innerHTML = html;
                    assistantDiv.appendChild(sourcesEl);
                }
                // Save to history
                if (fullResponse) {
                    Storage.addChatMessage({ role: 'assistant', content: fullResponse });
                }
            }
        }
    } catch (e) {
        contentEl.textContent = 'Something went wrong. Please try again.';
        contentEl.classList.add('error-text');
    }
};

window.handleChatKeydown = function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        window.sendQuestion();
    }
};

function addChatMessage(role, content) {
    const container = document.getElementById('chatContent');
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    div.innerHTML = `
        <div class="role-label">${role === 'user' ? 'You' : 'Assistant'}</div>
        <div class="message-content">${esc(content)}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

function loadChatHistory() {
    const history = Storage.getChatHistory();
    if (history.length > 0) {
        const container = document.getElementById('chatContent');
        const empty = container.querySelector('.empty-state');
        if (empty) empty.remove();
        // Show last 20 messages
        for (const msg of history.slice(-20)) {
            addChatMessage(msg.role, msg.content);
        }
    }
}

window.clearChat = function () {
    Storage.clearChatHistory();
    document.getElementById('chatContent').innerHTML = `
        <div class="empty-state">
            <p>Ask questions about your child's special education rights.</p>
            <p class="hint">Examples:</p>
            <ul class="hint">
                <li>"What is FAPE and what does my child have a right to?"</li>
                <li>"Can the school refuse to evaluate my child?"</li>
                <li>"What questions should I ask about my child's IEP goals?"</li>
            </ul>
        </div>
    `;
};

// ---- Transcription ----
window.toggleRecording = function () {
    if (isRecording) {
        Transcription.stop();
        isRecording = false;
    } else {
        Transcription.start();
        isRecording = true;
        // Clear transcript display
        const container = document.getElementById('transcriptContent');
        const empty = container.querySelector('.empty-state');
        if (empty) empty.remove();
        transcriptLines = 0;
        interimElement = null;
    }
    updateRecordingUI();
};

function updateRecordingUI() {
    const btn = document.getElementById('btnRecord');
    const status = document.getElementById('recordingStatus');
    if (isRecording) {
        btn.textContent = 'Stop Recording';
        btn.className = 'btn btn-danger';
        status.textContent = 'Listening...';
        status.className = 'status-badge recording';
    } else {
        btn.textContent = 'Start Meeting';
        btn.className = 'btn btn-primary';
        status.textContent = '';
        status.className = 'status-badge';
    }
}

function handleTranscriptFragment(fragment) {
    const container = document.getElementById('transcriptContent');

    if (fragment.is_final) {
        if (interimElement) {
            interimElement.remove();
            interimElement = null;
        }
        const line = document.createElement('div');
        line.className = 'transcript-line';
        line.textContent = fragment.text;
        container.appendChild(line);
        transcriptLines++;
        document.getElementById('transcriptCount').textContent = `${transcriptLines} lines`;
    } else {
        if (!interimElement) {
            interimElement = document.createElement('div');
            interimElement.className = 'transcript-line interim';
            container.appendChild(interimElement);
        }
        interimElement.textContent = fragment.text;
    }
    container.scrollTop = container.scrollHeight;
}

function handleTranscriptStatus(status) {
    const el = document.getElementById('recordingStatus');
    if (status === 'listening') {
        el.textContent = 'Listening...';
        el.className = 'status-badge recording';
    } else if (status === 'denied') {
        el.textContent = 'Microphone access denied';
        el.className = 'status-badge error';
        isRecording = false;
        updateRecordingUI();
    } else if (status === 'unsupported') {
        el.textContent = 'Not supported in this browser. Use Chrome or Edge.';
        el.className = 'status-badge error';
        isRecording = false;
        updateRecordingUI();
    }
}

window.copyTranscript = function () {
    const text = Transcription.getFullTranscript();
    if (text) {
        navigator.clipboard.writeText(text);
        const btn = document.getElementById('btnCopyTranscript');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    }
};

window.downloadTranscript = function () {
    const text = Transcription.getFullTranscript();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
};

// ---- Documents ----
window.showDocuments = function () {
    document.getElementById('documentModal').classList.add('active');
    renderDocumentList();
};

window.hideDocuments = function () {
    document.getElementById('documentModal').classList.remove('active');
};

window.handleFileSelect = async function (event) {
    const files = event.target.files;
    const status = document.getElementById('docProcessStatus');

    for (const file of files) {
        status.textContent = `Processing ${file.name}...`;
        try {
            const doc = await Documents.processFile(file);
            status.textContent = `${file.name}: ${doc.chunks.length} sections indexed`;
        } catch (e) {
            status.textContent = `Error processing ${file.name}: ${e.message}`;
        }
    }
    renderDocumentList();
    event.target.value = ''; // Reset file input
};

function renderDocumentList() {
    const list = document.getElementById('documentList');
    const docs = Documents.getLoadedDocuments();

    if (docs.length === 0) {
        list.innerHTML = '<p class="hint">No documents loaded. Your files are processed in your browser and never uploaded.</p>';
        return;
    }

    list.innerHTML = '';
    for (const doc of docs) {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.innerHTML = `
            <div class="item-info">
                <div class="item-name">${esc(doc.name)}</div>
                <div class="item-detail">${doc.chunks.length} sections | ${(doc.size / 1024).toFixed(0)} KB</div>
            </div>
            <div class="item-actions">
                <button class="btn btn-small btn-danger" onclick="removeDoc('${esc(doc.name)}')">Remove</button>
            </div>
        `;
        list.appendChild(card);
    }
}

window.removeDoc = function (name) {
    Documents.removeDocument(name);
    renderDocumentList();
};

// ---- Settings ----
window.showSettings = function () {
    document.getElementById('settingsModal').classList.add('active');
    document.getElementById('settingsApiKey').value = Storage.getApiKey();
    const info = Storage.getChildInfo();
    document.getElementById('settingsChildName').value = info.name || '';
    document.getElementById('settingsDistrict').value = info.district || '';
};

window.hideSettings = function () {
    document.getElementById('settingsModal').classList.remove('active');
};

window.saveSettings = function () {
    const key = document.getElementById('settingsApiKey').value.trim();
    if (key) Storage.setApiKey(key);
    Storage.setChildInfo({
        name: document.getElementById('settingsChildName').value.trim(),
        district: document.getElementById('settingsDistrict').value.trim(),
    });
    window.hideSettings();
};

// ---- Help ----
window.showHelp = function () {
    document.getElementById('helpModal').classList.add('active');
};

window.hideHelp = function () {
    document.getElementById('helpModal').classList.remove('active');
};

// ---- Utility ----
function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}
