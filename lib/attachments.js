const path = require('path');
const { UserInputError, inspectError } = require('./errors');

// Bot download/memory budget; this is not the Files API service limit.
const MAX_BYTES = 12 * 1024 * 1024;
const MIME = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.aiff': 'audio/aiff',
    '.mp4': 'video/mp4', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg',
    '.mov': 'video/quicktime', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
    '.pdf': 'application/pdf',
};
const TEXT = new Set(['.txt', '.md', '.mdx', '.markdown', '.rst', '.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.jsonc',
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.pyi', '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.xml', '.yaml', '.yml', '.log', '.ini', '.toml', '.cfg', '.conf', '.properties', '.sql', '.graphql', '.gql',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd', '.vue', '.svelte', '.c', '.h', '.cpp', '.hpp',
    '.cc', '.cxx', '.cs', '.rs', '.go', '.java', '.kt', '.kts', '.swift', '.rb', '.php', '.lua', '.r', '.dart',
    '.ex', '.exs', '.erl', '.hrl', '.hs', '.clj', '.scala', '.pl', '.pm', '.tex', '.bib', '.srt', '.vtt', '.diff', '.patch']);
const TEXT_NAMES = new Set(['dockerfile', 'containerfile', 'makefile', 'gnumakefile', 'cmakelists.txt', 'jenkinsfile',
    'gemfile', 'rakefile', 'procfile', 'readme', 'license', '.gitignore', '.gitattributes', '.dockerignore', '.editorconfig']);
const TEXT_MIMES = new Set(['application/json', 'application/ld+json', 'application/xml', 'application/javascript',
    'application/x-javascript', 'application/typescript', 'application/yaml', 'application/x-yaml', 'application/toml', 'application/sql']);
const supported = new Set(Object.values(MIME));
function attachmentType(attachment) {
    const ext = path.extname(attachment.name || '').toLowerCase();
    const declared = (attachment.contentType || '').split(';')[0].toLowerCase();
    if (TEXT.has(ext) || TEXT_NAMES.has(path.basename(attachment.name || '').toLowerCase()) || declared.startsWith('text/') || TEXT_MIMES.has(declared)) return 'text/plain';
    return MIME[ext] || (supported.has(declared) ? declared : null);
}

async function buildParts(attachments, fileManager, fetcher = fetch, options = {}) {
    const files = [...attachments.values()];
    if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) {
        throw new UserInputError('附件總大小上限為 12 MiB，請縮小或分次上傳。');
    }
    for (const file of files) {
        if (!attachmentType(file)) throw new UserInputError(`不支援的附件格式：${file.name}。請使用圖片、音訊、影片、PDF 或純文字檔。`);
    }
    let total = 0;
    const parts = [];
    const uploaded = [];
    const pause = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    try {
    for (const file of files) {
        const response = await fetcher(file.url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok || !response.body) throw Object.assign(new Error('附件下載失敗'), { status: response.status });
        const chunks = [];
        for await (const chunk of response.body) {
            total += chunk.length;
            if (total > MAX_BYTES) throw new UserInputError('附件總大小上限為 12 MiB，請縮小或分次上傳。');
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        const mimeType = attachmentType(file);
        if (mimeType === 'text/plain' && buffer.length > 1024 * 1024) throw new UserInputError('單個文字附件上限為 1 MiB。');
        if (mimeType === 'text/plain') {
            try {
                const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
                if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded)) throw new UserInputError('binary');
            } catch { throw new UserInputError(`附件「${file.name}」不是有效的 UTF-8 純文字，請轉成 UTF-8 後重傳。`); }
        }
        let remote = (await fileManager.uploadFile(buffer, { mimeType, displayName: file.name })).file;
        uploaded.push(remote.name);
        const deadline = Date.now() + (options.processingTimeoutMs ?? 180000);
        while (remote.state === 'PROCESSING') {
            if (Date.now() >= deadline) throw new UserInputError('附件處理逾時，請稍後重新上傳。');
            await pause(2000);
            remote = await fileManager.getFile(remote.name);
        }
        if (remote.state !== 'ACTIVE') throw new UserInputError('Google 無法處理此附件，請更換格式後重傳。');
        if (!remote.uri || !Number.isFinite(Date.parse(remote.expirationTime))) throw new UserInputError('附件服務未回傳有效的檔案期限。');
        parts.push({ cloudFile: { name: remote.name, uri: remote.uri, mimeType,
            originalName: file.name, expirationTime: remote.expirationTime, sizeBytes: buffer.length } });
    }
    return parts;
    } catch (error) {
        await Promise.allSettled(uploaded.map(name => fileManager.deleteFile(name)));
        throw error;
    }
}

// Strip local metadata before constructing an API request. Never send expired URIs.
async function resolveParts(parts, fileManager, cache = new Map(), now = Date.now()) {
    const resolved = [];
    for (const part of parts) {
        if (!part.cloudFile) {
            resolved.push(part.savedAttachment || part.inlineData
                ? { text: '[舊版附件不再載入本機原檔，如需分析請重新上傳。]' } : part);
            continue;
        }
        const file = part.cloudFile;
        let active = Number.isFinite(Date.parse(file.expirationTime)) && Date.parse(file.expirationTime) > now + 120000;
        if (active) {
            if (!cache.has(file.name)) {
                try {
                    const remote = await fileManager.getFile(file.name);
                    cache.set(file.name, remote.state === 'ACTIVE' && Date.parse(remote.expirationTime) > now + 120000);
                } catch (error) {
                    if (inspectError(error).status === 404 || inspectError(error).status === 403) cache.set(file.name, false);
                    else throw error;
                }
            }
            active = cache.get(file.name);
        }
        resolved.push(active ? { fileData: { fileUri: file.uri, mimeType: file.mimeType } }
            : { text: `[附件「${file.originalName}」已過期或無法存取。若需要原檔細節，請要求使用者重新上傳，不要假裝已讀取附件。]` });
    }
    return resolved;
}
module.exports = { attachmentType, buildParts, resolveParts, MAX_BYTES };
