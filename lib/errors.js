class UserInputError extends Error {}

function inspectError(error) {
    const nodes = [], seen = new Set();
    function visit(value, depth = 0) {
        if (!value || typeof value !== 'object' || seen.has(value) || depth > 5) return;
        seen.add(value); nodes.push(value);
        // SDK responses expose getters such as .data; inspecting errors must not execute them.
        for (const key of ['cause', 'error', 'response', 'data', 'promptFeedback']) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor && 'value' in descriptor) visit(descriptor.value, depth + 1);
        }
        for (const item of value.candidates || []) visit(item, depth + 1);
    }
    visit(error);
    const message = nodes.map(node => node.message || '').filter(Boolean).join('\n') || String(error);
    let status;
    for (const node of nodes) {
        const value = [node.status, node.statusCode, node.code].map(Number).find(number => Number.isInteger(number) && number >= 400 && number <= 599);
        if (value) { status = value; break; }
    }
    status ??= Number(message.match(/\[(4\d\d|5\d\d)\b/)?.[1] || message.match(/\b(?:HTTP|status(?: code)?)\s*[:=]?\s*(4\d\d|5\d\d)\b/i)?.[1]) || undefined;
    const blocked = nodes.map(node => node.blockReason || node.finishReason).find(reason =>
        ['PROHIBITED_CONTENT', 'SAFETY', 'BLOCKLIST', 'RECITATION', 'SPII', 'IMAGE_SAFETY'].includes(reason))
        || message.match(/\b(PROHIBITED_CONTENT|SAFETY|BLOCKLIST|RECITATION|SPII|IMAGE_SAFETY)\b/)?.[1];
    return { status, blocked, message, codes: nodes.map(node => node.code || node.name || '').join(' ') };
}

function errorMessage(error, stage = 'generation') {
    const { status, blocked, message, codes } = inspectError(error);
    if (error instanceof UserInputError) return error.message;
    if (stage === 'discord_send' || stage === 'discord_permissions') {
        return `Discord 訊息操作失敗${status ? `（${status}）` : ''}，請檢查頻道權限或稍後再試。`;
    }
    if (stage === 'history_save') return '回答已產生，但對話紀錄儲存失敗，請檢查磁碟空間與檔案權限。';
    if (blocked) return `模型因內容限制未能提供回答（${blocked}），請調整訊息或附件內容。`;
    if (codes.includes('EMPTY_RESPONSE')) return '模型未產生文字回答，請稍後再試或調整提問。';
    if (status === 429) return 'Gemini 請求過多或配額已耗盡（429）。請稍後再試；若持續發生，請檢查配額與帳務。';
    if ([500, 502, 503, 504].includes(status)) return `Gemini／附件服務暫時異常（${status}），請稍後再試。`;
    if (status === 401 || status === 403) return `API 驗證或存取權限失敗（${status}），請檢查金鑰與專案權限。`;
    if (status === 404) {
        if (stage.startsWith('attachment') || /\/files\//.test(message)) return '附件不存在、已過期或無法取得（404），請重新上傳。';
        return '模型或 API 資源不存在（404），請檢查模型名稱與可用性。';
    }
    if (status === 400) return 'API 拒絕此請求（400），可能是內容大小、請求格式或模型功能不相容，請查看主控台詳細原因。';
    if (/TimeoutError|AbortError|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timed?\s*out|逾時/i.test(message + codes)) return '請求逾時，請稍後再試。';
    if (/fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|socket/i.test(message + codes)) return '連線至服務失敗，請檢查網路或稍後再試。';
    return `處理訊息時發生錯誤${status ? `（${status}）` : ''}，請查看主控台紀錄以確認原因。`;
}
module.exports = { UserInputError, inspectError, errorMessage };
