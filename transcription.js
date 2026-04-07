/**
 * Live transcription using the Web Speech API (built into browsers, free).
 * Works in Chrome, Edge, and Safari.
 */

let recognition = null;
let isListening = false;
let transcriptBuffer = [];
let onFragmentCallback = null;
let onStatusCallback = null;

export function isSupported() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

export function onFragment(callback) {
    onFragmentCallback = callback;
}

export function onStatus(callback) {
    onStatusCallback = callback;
}

export function start() {
    if (isListening) return;
    if (!isSupported()) {
        if (onStatusCallback) onStatusCallback('unsupported');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        isListening = true;
        if (onStatusCallback) onStatusCallback('listening');
    };

    recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const text = result[0].transcript.trim();
            if (!text) continue;

            const fragment = {
                text,
                is_final: result.isFinal,
            };

            if (result.isFinal) {
                transcriptBuffer.push(text);
            }

            if (onFragmentCallback) onFragmentCallback(fragment);
        }
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
            if (onStatusCallback) onStatusCallback('denied');
            isListening = false;
        } else if (event.error === 'no-speech') {
            // Normal — just means silence, will auto-continue
        } else {
            console.warn('Speech recognition error:', event.error);
        }
    };

    recognition.onend = () => {
        // Auto-restart if we're still supposed to be listening
        if (isListening) {
            try {
                recognition.start();
            } catch (e) {
                // May fail if called too quickly
                setTimeout(() => {
                    if (isListening) {
                        try { recognition.start(); } catch (e2) { /* give up */ }
                    }
                }, 500);
            }
        } else {
            if (onStatusCallback) onStatusCallback('stopped');
        }
    };

    try {
        recognition.start();
    } catch (e) {
        if (onStatusCallback) onStatusCallback('error');
    }
}

export function stop() {
    isListening = false;
    if (recognition) {
        try {
            recognition.stop();
        } catch (e) {
            // Already stopped
        }
    }
    if (onStatusCallback) onStatusCallback('stopped');
}

export function getRecentTranscript(maxChars = 2000) {
    const full = transcriptBuffer.join(' ');
    if (full.length > maxChars) return full.slice(-maxChars);
    return full;
}

export function getFullTranscript() {
    return transcriptBuffer.join(' ');
}

export function clearTranscript() {
    transcriptBuffer = [];
}

export function getIsListening() {
    return isListening;
}
