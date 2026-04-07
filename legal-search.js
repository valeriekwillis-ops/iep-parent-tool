/**
 * Client-side legal knowledge base search using MiniSearch.
 * Loads the pre-built legal-kb.json and provides TF-IDF search.
 */

let miniSearch = null;
let chunks = [];
let loaded = false;

export async function initLegalKB() {
    if (loaded) return;

    const response = await fetch('./data/legal-kb.json');
    const kb = await response.json();
    chunks = kb.chunks;

    // Dynamic import of MiniSearch from CDN
    const MiniSearch = (await import('https://cdn.jsdelivr.net/npm/minisearch@7.1.1/+esm')).default;

    miniSearch = new MiniSearch({
        fields: ['text', 'citation', 'section', 'keywordsText'],
        storeFields: ['text', 'source', 'source_short', 'section', 'citation', 'keywords'],
        searchOptions: {
            boost: { citation: 3, section: 2, keywordsText: 2 },
            fuzzy: 0.2,
            prefix: true,
        },
    });

    // Prepare documents with a combined keywords text field for searching
    const docs = chunks.map(c => ({
        ...c,
        keywordsText: (c.keywords || []).join(' '),
    }));

    miniSearch.addAll(docs);
    loaded = true;
    console.log(`Legal KB loaded: ${chunks.length} chunks`);
}

export function searchLegal(query, maxResults = 5) {
    if (!miniSearch || !loaded) return [];

    const results = miniSearch.search(query, { limit: maxResults });

    return results.map(r => ({
        text: r.text,
        source: r.source,
        source_short: r.source_short,
        section: r.section,
        citation: r.citation,
        keywords: r.keywords,
        score: r.score,
    }));
}

export function isLoaded() {
    return loaded;
}
