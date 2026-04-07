/**
 * localStorage wrapper for persisting settings, chat history, and transcripts.
 * All data stays on the parent's device.
 */

const PREFIX = 'thrive_iep_';

export const Storage = {
    // --- API Key ---
    getApiKey() {
        return localStorage.getItem(`${PREFIX}api_key`) || '';
    },
    setApiKey(key) {
        localStorage.setItem(`${PREFIX}api_key`, key);
    },
    clearApiKey() {
        localStorage.removeItem(`${PREFIX}api_key`);
    },

    // --- Child Info ---
    getChildInfo() {
        const raw = localStorage.getItem(`${PREFIX}child_info`);
        return raw ? JSON.parse(raw) : { name: '', district: '', grade: '', disabilities: '' };
    },
    setChildInfo(info) {
        localStorage.setItem(`${PREFIX}child_info`, JSON.stringify(info));
    },

    // --- Chat History ---
    getChatHistory() {
        const raw = localStorage.getItem(`${PREFIX}chat_history`);
        return raw ? JSON.parse(raw) : [];
    },
    addChatMessage(msg) {
        const history = this.getChatHistory();
        history.push({ ...msg, timestamp: Date.now() });
        // Keep last 100 messages
        if (history.length > 100) history.splice(0, history.length - 100);
        localStorage.setItem(`${PREFIX}chat_history`, JSON.stringify(history));
    },
    clearChatHistory() {
        localStorage.removeItem(`${PREFIX}chat_history`);
    },

    // --- Transcript ---
    getTranscript() {
        return localStorage.getItem(`${PREFIX}transcript`) || '';
    },
    saveTranscript(text) {
        localStorage.setItem(`${PREFIX}transcript`, text);
    },
    clearTranscript() {
        localStorage.removeItem(`${PREFIX}transcript`);
    },

    // --- Settings ---
    getSettings() {
        const raw = localStorage.getItem(`${PREFIX}settings`);
        return raw ? JSON.parse(raw) : { setupComplete: false };
    },
    setSettings(settings) {
        const current = this.getSettings();
        localStorage.setItem(`${PREFIX}settings`, JSON.stringify({ ...current, ...settings }));
    },

    // --- Has completed setup? ---
    isSetupComplete() {
        return this.getSettings().setupComplete && this.getApiKey().length > 0;
    },
    completeSetup() {
        this.setSettings({ setupComplete: true });
    },
};
