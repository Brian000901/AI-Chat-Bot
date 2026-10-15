const { PermissionFlagsBits } = require('discord.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function splitMessage(text, limit = 2000) {
    const chunks = [];
    while (text.length > limit) {
        let end = limit;
        if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--;
        chunks.push(text.slice(0, end));
        text = text.slice(end);
    }
    if (text) chunks.push(text);
    return chunks;
}

function createQueue() {
    const pending = new Map();
    return (key, task) => {
        const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(task);
        pending.set(key, next);
        const cleanup = () => { if (pending.get(key) === next) pending.delete(key); };
        next.then(cleanup, cleanup);
        return next;
    };
}

function createSender(delay = 1100) {
    const queue = createQueue();
    let lastSent = 0;
    return message => queue('global', async () => {
        await sleep(Math.max(0, lastSent + delay - Date.now()));
        try { return await message(); }
        finally { lastSent = Date.now(); }
    });
}

function isOwner(userId) {
    return (process.env.OWNER_IDS || '810409750625386497').split(',').map(id => id.trim()).includes(userId);
}

function canUse(interaction, access) {
    if (!interaction.inGuild()) return false;
    if (isOwner(interaction.user.id)) return true;
    if (access === 'owner') return false;
    const required = access === 'admin' ? PermissionFlagsBits.Administrator : PermissionFlagsBits.ManageMessages;
    return interaction.memberPermissions?.has(required) === true;
}

function canSend(channel, member) {
    const permissions = channel.permissionsFor(member);
    return permissions?.has([
        PermissionFlagsBits.ViewChannel,
        channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
    ]) === true;
}

module.exports = { splitMessage, createQueue, createSender, canUse, canSend };
