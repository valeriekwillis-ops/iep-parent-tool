/**
 * AI chat via Groq free tier API (called directly from the browser).
 * Each parent uses their own free API key.
 */

import { Storage } from './storage.js';
import { searchLegal } from './legal-search.js';
import { searchDocuments } from './documents.js';
import * as Transcription from './transcription.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

const SYSTEM_PROMPT = `You are a helpful special education assistant created by Thrive Advocacy Group. You help parents and caregivers understand their rights and navigate IEP (Individualized Education Program) and ARD (Admission, Review, and Dismissal) meetings in Texas.

ROLE BOUNDARIES:
- You are NOT an attorney and do not provide legal advice.
- You explain special education law in plain, parent-friendly language.
- You cite specific laws and regulations so parents can reference them in meetings.
- You suggest questions parents can ask the school's ARD committee.
- You flag when an issue may need an attorney or advocate.

RESPONSE FORMAT:
- Lead with a direct, clear answer in everyday language.
- Then cite the specific legal authority (e.g., "Under 34 CFR 300.502, you have the right to...").
- Suggest 1-3 specific questions the parent could ask the school.
- Keep responses concise — the parent may be in a live meeting.
- Use bullet points for action items.

KEY LEGAL FRAMEWORKS:
- IDEA (Individuals with Disabilities Education Act) - 20 USC 1400-1482
- IDEA Regulations - 34 CFR Part 300
- Section 504 of the Rehabilitation Act
- Texas Education Code Chapter 29
- Texas Administrative Code Title 19, Chapter 89
- FAPE (Free Appropriate Public Education)
- LRE (Least Restrictive Environment)

IMPORTANT TEXAS-SPECIFIC RULES:
- In Texas, the IEP team is called the ARD (Admission, Review, and Dismissal) committee.
- Parents have the right to audio record ARD meetings (TEC 29.005(d)).
- If the ARD committee cannot reach consensus, parents can request a 10-school-day recess (19 TAC 89.1050).
- Full Individual Evaluation (FIE) must be completed within 45 school days of consent (TEC 29.004).

When citing laws, always include the specific section number so the parent can look it up or reference it in the meeting.`;

function buildContextMessage(legalResults, docResults, transcriptText) {
    const parts = [];

    if (legalResults.length > 0) {
        parts.push('RELEVANT LAW (cite these in your answer):');
        parts.push('---');
        for (const r of legalResults) {
            const label = r.citation ? `[${r.source_short}: ${r.citation}]` : `[${r.source_short}]`;
            parts.push(label);
            parts.push(r.text);
            parts.push('---');
        }
    }

    if (docResults.length > 0) {
        parts.push("\nCHILD'S DOCUMENTS (reference these for personalized answers):");
        parts.push('---');
        for (const r of docResults) {
            let label = `[Document: ${r.source}`;
            if (r.page) label += `, page ${r.page}`;
            if (r.iepSection) label += `, section: ${r.iepSection}`;
            label += ']';
            parts.push(label);
            parts.push(r.text);
            parts.push('---');
        }
    }

    if (transcriptText) {
        parts.push('\nRECENT MEETING TRANSCRIPT:');
        parts.push('---');
        parts.push(transcriptText);
        parts.push('---');
    }

    return parts.join('\n');
}

export async function testConnection(apiKey) {
    try {
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: FALLBACK_MODEL,
                messages: [{ role: 'user', content: 'Say "connected" in one word.' }],
                max_tokens: 10,
            }),
        });

        if (response.status === 401) return { ok: false, error: 'Invalid API key. Please check and try again.' };
        if (response.status === 429) return { ok: false, error: 'Rate limited. Wait a minute and try again.' };
        if (!response.ok) return { ok: false, error: `Error: ${response.statusText}` };

        return { ok: true };
    } catch (e) {
        return { ok: false, error: 'Could not connect. Check your internet connection.' };
    }
}

export async function* sendMessage(question, includeTranscript = true) {
    const apiKey = Storage.getApiKey();
    if (!apiKey) {
        yield { type: 'error', data: 'Please set up your API key first.' };
        return;
    }

    // Search legal knowledge base
    const legalResults = searchLegal(question, 5);

    // Search loaded documents
    const docResults = searchDocuments(question, 5);

    // Get transcript context if active
    const transcriptText = includeTranscript && Transcription.getIsListening()
        ? Transcription.getRecentTranscript()
        : null;

    // Emit sources
    yield {
        type: 'sources',
        data: {
            legal: legalResults.map(r => ({ source: r.source_short, citation: r.citation })),
            documents: docResults.map(r => ({ source: r.source, page: r.page })),
        },
    };

    // Build messages
    const context = buildContextMessage(legalResults, docResults, transcriptText);
    const userMessage = context ? `${context}\n\nQUESTION: ${question}` : question;

    // Include recent chat history for continuity
    const chatHistory = Storage.getChatHistory().slice(-6);
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...chatHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage },
    ];

    // Try primary model, fall back to smaller model if rate limited
    for (const model of [MODEL, FALLBACK_MODEL]) {
        try {
            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages,
                    stream: true,
                    max_tokens: 2048,
                    temperature: 0.3,
                }),
            });

            if (response.status === 429 && model === MODEL) {
                continue; // Try fallback model
            }

            if (response.status === 401) {
                yield { type: 'error', data: 'Your API key is invalid. Please update it in Settings.' };
                return;
            }

            if (!response.ok) {
                yield { type: 'error', data: `Error from AI service (${response.status}). Try again.` };
                return;
            }

            // Stream the response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '[DONE]') {
                        yield { type: 'done' };
                        return;
                    }
                    try {
                        const data = JSON.parse(jsonStr);
                        const content = data.choices?.[0]?.delta?.content;
                        if (content) {
                            yield { type: 'text', data: content };
                        }
                    } catch (e) {
                        // Skip malformed JSON
                    }
                }
            }

            yield { type: 'done' };
            return;

        } catch (e) {
            if (model === FALLBACK_MODEL) {
                yield { type: 'error', data: 'Could not connect to AI service. Check your internet.' };
                return;
            }
            // Try fallback
        }
    }
}
