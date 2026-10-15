const { log } = require('./lib/logger');
const { Client, GatewayIntentBits, Collection, Events, REST, Routes, MessageFlags } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const path = require('path');
const JSONdb = require('simple-json-db');
const { splitMessage, createQueue, createSender, canUse, canSend } = require('./lib/runtime');
const { buildParts, resolveParts } = require('./lib/attachments');
const { HistoryStore, fitHistory } = require('./lib/history');
const { WEB_TOOLS, WEB_INSTRUCTION, logToolUse } = require('./lib/web');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_TOKEN);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_TOKEN, { timeout: 120000 });
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
const context = { history, db, setModel(name) {
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
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID || client.user.id), {
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
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        history.bind(interaction.channelId, interaction.guildId);
        await queue(interaction.channelId, () => command.execute(interaction, context));
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
        history.bind(message.channelId, message.guildId);
        const member = message.guild.members.me || await message.guild.members.fetchMe();
        if (!canSend(message.channel, member)) return;
        try {
            if (/^!(reset|pop|model)(?:\s|$)/i.test(message.content)) {
                await replyLong(message, '管理指令已改為 /reset、/pop、/model，請使用斜線指令。');
                return;
            }
            // Reject unsupported/oversized attachments before calling the paid model API.
            let parts;
            try { parts = await buildParts(message.attachments, fileManager); }
            catch (error) {
                log('error', 'Attachment failed:', error.message);
                await replyLong(message, error.status ? '附件服務暫時不可用，請稍後重傳。' : error.message);
                return;
            }
            await message.channel.sendTyping();
            const model = genAI.getGenerativeModel({
                model: process.env.MODEL,
                systemInstruction: fs.readFileSync(path.join(__dirname, 'prompt.md'), 'utf8') + '\n\n' + WEB_INSTRUCTION,
                tools: WEB_TOOLS,
                safetySettings: ['HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_HARASSMENT']
                    .map(category => ({ category, threshold: 'BLOCK_NONE' })),
            }, { timeout: 120000 });
            const previous = fitHistory(history.get(message.channelId) || [], parts);
            const fileCache = new Map();
            const apiHistory = [];
            for (const record of previous) apiHistory.push({ ...record, parts: await resolveParts(record.parts, fileManager, fileCache) });
            const chat = model.startChat({
                generationConfig: { temperature: 1, topP: 0.95, topK: 40, maxOutputTokens: 8192, responseMimeType: 'text/plain' },
                history: apiHistory,
            });
            const text = `[${message.author.username}]: ${message.content || '請分析附件。'}`;
            const response = await chat.sendMessage([{ text }, ...await resolveParts(parts, fileManager, fileCache)]);
            logToolUse(response.response, { guildId: message.guildId, channelId: message.channelId, messageId: message.id });
            const result = response.response.text();
            if (result) {
                const updated = [...(history.get(message.channelId) || []), { role: 'user', parts: [{ text }, ...parts] },
                    { role: 'model', parts: [{ text: result }] }];
                history.set(message.channelId, updated);
            }
            await replyLong(message, result);
        } catch (error) {
            log('error', 'Message processing failed:', error.message);
            const content = error.status === 429 ? '目前請求太多，請稍後再試。'
                : error.status === 503 ? '模型服務暫時不可用，請稍後再試。'
                : error.status === 400 ? '模型拒絕此請求，請檢查附件或上下文大小，並確認目前模型支援 Google Search 與 URL Context（兩項工具永久啟用）。'
                : '回應失敗，請確認模型支援此附件格式，或稍後再試。';
            await replyLong(message, content);
        }
    }).catch(error => log('error', 'Message handling failed:', error.message));
});
client.login(process.env.TOKEN).catch(error => { log('error', 'Login failed:', error.message); process.exitCode = 1; });
