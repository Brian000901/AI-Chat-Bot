const { attachmentType } = require('./attachments');
const { log } = require('./logger');

function identity(user, member) {
    return { id: user.id, display_name: member?.displayName || user.globalName || user.username, username: user.username };
}
function attachmentInfo(attachments) {
    return [...attachments.values()].map(file => ({ name: file.name, mime_type: attachmentType(file) || file.contentType || 'application/octet-stream' }));
}
async function buildMessageContext(message, botId) {
    const cache = new Map();
    async function lookup(id, fallbackUser, fallbackMember) {
        if (!cache.has(id)) cache.set(id, (async () => {
            try {
                const member = await message.guild.members.fetch({ user: id, force: true });
                return identity(member.user, member);
            } catch {
                try {
                    const user = await message.client.users.fetch(id, { force: true });
                    return identity(user);
                } catch (error) {
                    log('warn', '無法取得 Discord 使用者資料', { id, error: error.message });
                    return fallbackUser ? { ...identity(fallbackUser, fallbackMember), status: 'cached' } : { id, status: 'unavailable' };
                }
            }
        })());
        return cache.get(id);
    }
    const context = {
        sender: message.member ? identity(message.author, message.member) : await lookup(message.author.id, message.author),
        content: message.content,
    };
    // Only explicit user mentions in the content, not roles or implicit reply pings.
    const ids = [...new Set([...message.content.matchAll(/<@!?(\d+)>/g)].map(match => match[1]))];
    const mentions = await Promise.all(ids.filter(id => id !== botId).map(id => lookup(id)));
    if (mentions.length) context.mentions = mentions;
    if (message.reference?.messageId) {
        try {
            const referenced = await message.fetchReference();
            context.reply_to = {
                message_id: referenced.id,
                author: await lookup(referenced.author.id, referenced.author, referenced.member),
                content: referenced.content,
            };
            if (referenced.attachments.size) context.reply_to.attachments = attachmentInfo(referenced.attachments);
        } catch (error) {
            context.reply_to = { message_id: message.reference.messageId, status: 'unavailable' };
            log('warn', '無法讀取被回覆訊息', { messageId: message.reference.messageId, error: error.message });
        }
    }
    if (message.attachments.size) context.attachments = attachmentInfo(message.attachments);
    return context;
}
module.exports = { buildMessageContext };
