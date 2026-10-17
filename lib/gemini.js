const { GoogleGenAI } = require('@google/genai');
const { WEB_TOOLS, WEB_INSTRUCTION } = require('./web');
const { inspectError } = require('./errors');

function createGemini(apiKey, sdk) {
    const ai = sdk || new GoogleGenAI({ apiKey, httpOptions: { timeout: 120000, retryOptions: { attempts: 1 } } });
    return {
        files: ai.files,
        async generate({ model, systemInstruction, history, parts }) {
            // History stays in our own JSON format; SDK chat state is request-local.
            const chat = ai.chats.create({
                model,
                history: structuredClone(history),
                config: {
                    systemInstruction: systemInstruction + '\n\n' + WEB_INSTRUCTION,
                    tools: structuredClone(WEB_TOOLS),
                    temperature: 1, topP: 0.95, topK: 40,
                    maxOutputTokens: 8192, responseMimeType: 'text/plain',
                    safetySettings: ['HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                        'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_HARASSMENT']
                        .map(category => ({ category, threshold: 'BLOCK_NONE' })),
                },
            });
            return chat.sendMessage({ message: parts });
        },
    };
}

function readResponseText(response) {
    const { blocked } = inspectError({ response });
    if (blocked) throw Object.assign(new Error(`Response blocked: ${blocked}`), { response });
    // Unlike the old SDK, the new text getter may return undefined on blocked/empty responses.
    const text = response.text;
    if (typeof text !== 'string' || !text.trim()) {
        throw Object.assign(new Error('Gemini returned no text'), { response, code: 'EMPTY_RESPONSE' });
    }
    return text;
}
module.exports = { createGemini, readResponseText };
