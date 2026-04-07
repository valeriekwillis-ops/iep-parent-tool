/**
 * In-browser document processing for PDFs, DOCX, and text files.
 * Files are parsed entirely in the browser — nothing is uploaded.
 */

let loadedDocuments = [];

// IEP section patterns for better context
const IEP_PATTERNS = [
    /present\s+level/i, /annual\s+goal/i, /special\s+education\s+services/i,
    /related\s+services/i, /accommodations/i, /modifications/i,
    /transition/i, /behavior\s+intervention/i, /least\s+restrictive/i,
    /assessment/i, /eligibility/i, /evaluation\s+results/i,
    /extended\s+school\s+year/i, /assistive\s+technology/i,
    /schedule\s+of\s+services/i, /supplementary\s+aids/i,
];

function detectIEPSection(text) {
    const snippet = text.slice(0, 200).toLowerCase();
    for (const pattern of IEP_PATTERNS) {
        if (pattern.test(snippet)) {
            return snippet.match(pattern)[0].replace(/\\s\+/g, ' ');
        }
    }
    return null;
}

function chunkText(text, maxChars = 1500, overlap = 200) {
    if (text.length <= maxChars) return [text];
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        let end = start + maxChars;
        if (end < text.length) {
            const nlPos = text.lastIndexOf('\n\n', end);
            if (nlPos > start + maxChars / 2) end = nlPos;
            else {
                const dotPos = text.lastIndexOf('. ', end);
                if (dotPos > start + maxChars / 2) end = dotPos + 1;
            }
        }
        const chunk = text.slice(start, end).trim();
        if (chunk) chunks.push(chunk);
        start = end < text.length ? end - overlap : text.length;
    }
    return chunks;
}

async function parsePDF(file) {
    // Load pdf.js from CDN if not already loaded
    if (!window.pdfjsLib) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        if (text.trim()) {
            pages.push({ text: text.trim(), page: i });
        }
    }

    return pages;
}

async function parseDOCX(file) {
    // Load mammoth.js from CDN if not already loaded
    if (!window.mammoth) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js');
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return [{ text: result.value, page: null }];
}

function parseTXT(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            resolve([{ text: e.target.result, page: null }]);
        };
        reader.readAsText(file);
    });
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

export async function processFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let pages;

    if (ext === 'pdf') {
        pages = await parsePDF(file);
    } else if (ext === 'docx' || ext === 'doc') {
        pages = await parseDOCX(file);
    } else if (ext === 'txt') {
        pages = await parseTXT(file);
    } else {
        throw new Error(`Unsupported file type: .${ext}`);
    }

    // Chunk all pages
    const chunks = [];
    for (const page of pages) {
        const textChunks = chunkText(page.text);
        for (const chunkText of textChunks) {
            chunks.push({
                text: chunkText,
                source: file.name,
                page: page.page,
                iepSection: detectIEPSection(chunkText),
            });
        }
    }

    const doc = {
        name: file.name,
        size: file.size,
        type: ext,
        chunks,
        addedAt: Date.now(),
    };

    loadedDocuments.push(doc);
    return doc;
}

export function searchDocuments(query, maxResults = 5) {
    if (loadedDocuments.length === 0) return [];

    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    // Simple keyword scoring across all document chunks
    const scored = [];
    for (const doc of loadedDocuments) {
        for (const chunk of doc.chunks) {
            const textLower = chunk.text.toLowerCase();
            let score = 0;
            for (const word of queryWords) {
                const count = (textLower.match(new RegExp(word, 'g')) || []).length;
                score += count;
            }
            if (score > 0) {
                scored.push({ ...chunk, score });
            }
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
}

export function getLoadedDocuments() {
    return loadedDocuments;
}

export function removeDocument(name) {
    loadedDocuments = loadedDocuments.filter(d => d.name !== name);
}

export function clearDocuments() {
    loadedDocuments = [];
}
