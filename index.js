const { log } = require('./lib/logger');
const { Client, GatewayIntentBits, Collection, Events, REST, Routes, MessageFlags } = require('discord.js');
const { createGemini, readResponseText } = require('./lib/gemini');
const fs = require('fs');
const path = require('path');
const JSONdb = require('simple-json-db');
const { splitMessage, createQueue, createSender, canUse, canSend } = require('./lib/runtime');
const { buildParts, resolveParts } = require('./lib/attachments');
const { HistoryStore, fitHistory } = require('./lib/history');
const { logToolUse } = require('./lib/web');
const { buildMessageContext } = require('./lib/message-context');
const { inspectError, errorMessage } = require('./lib/errors');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const gemini = createGemini(process.env.GEMINI_TOKEN);
const fileManager = gemini.files;
const history = new HistoryStore(path.join(__dirname, 'history'));
const queue = createQueue();
const send = createSender();
const dbPath = path.join(__dirname, 'db/channels.json');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new JSONdb(dbPath);
client.commands = new Collection();
for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'))) {
    const command = require(path.join(__dirname, 'commands', file));
    client.commands.set(command.data.name, command);
}
const context = { history, db, queue, setModel(name) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$/.test(name)) throw new Error('模型名稱格式不正確。');
    const envPath = path.join(__dirname, '.env');
    const original = fs.readFileSync(envPath, 'utf8');
    const updated = /^MODEL\s*=.*$/m.test(original)
        ? original.replace(/^MODEL\s*=.*$/m, `MODEL='${name}'`)
        : `${original}\nMODEL='${name}'\n`;
    fs.writeFileSync(envPath, updated);
    process.env.MODEL = name;
} };

client.once(Events.ClientReady, async () => {
    log('success', 'Discord 已登入', { bot: client.user.tag, model: process.env.MODEL });
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), {
            body: [...client.commands.values()].map(command => command.data.toJSON()),
        });
        log('success', '斜線指令註冊完成');
    } catch (error) { log('error', 'Command registration failed:', error.message); }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
        if (!canUse(interaction, command.access)) {
            await interaction.reply({ content: '你沒有權限使用此指令，或此指令無法在私訊使用。', flags: MessageFlags.Ephemeral });
            return;
        }
        history.bind(interaction.channelId, interaction.guildId);
        await command.execute(interaction, context);
    } catch (error) {
        log('error', 'Command failed:', error.message);
        const content = '指令執行失敗，請檢查參數或稍後再試。';
        try {
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch (replyError) { log('error', 'Command error reply failed:', replyError.message); }
    }
});

async function replyLong(message, text) {
    const chunks = splitMessage(text || '模型未回傳文字，請換個方式提問。');
    for (let index = 0; index < chunks.length; index++) {
        const payload = { content: chunks[index], allowedMentions: { parse: [], repliedUser: false } };
        await send(() => index === 0 ? message.reply({ ...payload, failIfNotExists: false }) : message.channel.send(payload));
    }
}

client.on(Events.MessageCreate, message => {
    if (!message.inGuild() || message.author.bot || message.webhookId || message.content.startsWith('-#')) return;
    if (!(db.get('channels') || []).includes(message.channelId) && !message.mentions.users.has(client.user.id)) return;
    queue(message.channelId, async () => {
        let stage = 'discord_permissions';
        try {
            history.bind(message.channelId, message.guildId);
            const member = message.guild.members.me || await message.guild.members.fetchMe();
            if (!canSend(message.channel, member)) return;
            stage = 'message_context';
            const text = JSON.stringify(await buildMessageContext(message, client.user.id));
            stage = 'attachment_upload';
            const parts = await buildParts(message.attachments, fileManager);
            await message.channel.sendTyping().catch(error => log('warn', 'Discord 輸入中提示失敗', { error: error.message }));
            stage = 'generation_setup';
            const systemInstruction = fs.readFileSync(path.join(__dirname, 'prompt.md'), 'utf8');
            const previous = fitHistory(history.get(message.channelId) || [], parts);
            const fileCache = new Map();
            const apiHistory = [];
            stage = 'attachment_resolve';
            for (const record of previous) apiHistory.push({ ...record, parts: await resolveParts(record.parts, fileManager, fileCache) });
            const currentParts = [{ text }, ...await resolveParts(parts, fileManager, fileCache)];
            stage = 'generation';
            const response = await gemini.generate({
                model: process.env.MODEL, systemInstruction, history: apiHistory, parts: currentParts,
            });
            logToolUse(response, { guildId: message.guildId, channelId: message.channelId, messageId: message.id });
            const result = readResponseText(response);
            if (result) {
                const updated = [...(history.get(message.channelId) || []), { role: 'user', parts: [{ text }, ...parts] },
                    { role: 'model', parts: [{ text: result }] }];
                stage = 'history_save';
                history.set(message.channelId, updated);
            }
            stage = 'discord_send';
            await replyLong(message, result);
        } catch (error) {
            const details = inspectError(error);
            log('error', 'Message processing failed', { stage, status: details.status, blocked: details.blocked,
                channelId: message.channelId, messageId: message.id, detail: details.message });
            // A Discord send failure must not restart the response or repeat already sent chunks.
            if (stage !== 'discord_send' && stage !== 'discord_permissions') {
                try { await replyLong(message, errorMessage(error, stage)); }
                catch (sendError) { log('error', 'Discord 錯誤通知發送失敗', { detail: sendError.message }); }
            }
        }
    }).catch(error => log('error', 'Message handling failed:', error.message));
});
client.login(process.env.TOKEN).catch(error => { log('error', 'Login failed:', error.message); process.exitCode = 1; });
