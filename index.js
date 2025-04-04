const { Client, GatewayIntentBits, Collection, Events, REST, Routes,} = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const JSONdb = require('simple-json-db');

require("dotenv").config();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`Ready! Logged in as ${client.user.tag}`);
});

client.commands = new Collection();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

const commands = commandFiles.map(file => {
    const command = require(`./commands/${file}`);
    return command.data.toJSON();
});

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log(`Successfully reloaded ${commands.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
})();

console.log(`\x1b[32mUsing model: ${process.env.MODEL}\x1b[0m`);

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_TOKEN);

let history = {};

client.on('messageCreate', async message => {
    if (message.author.id === client.user.id) return;
    if (message.content.startsWith('-#')) return;
    if (message.content.startsWith('!reset')) {
        history[message.channel.id] = [];
        message.reply('已重置對話記錄');
        return;
    }

    if (message.content.startsWith('!pop')) {
        const count = parseInt(message.content.split(' ')[1], 10);
        if (Number.isInteger(count) && history[message.channel.id] && count <= history[message.channel.id].length) {
            for (let i = 0; i < count; i++) {
                history[message.channel.id].pop();
            }
            message.reply(`已清除最後${count}則記錄`);
            return;
        } else {
            message.reply('發生了某種錯誤');
            return;
        }
    }

    if (message.content.startsWith('!model') && message.author.id === '810409750625386497') {
        const envPath = '.env';
        const envContent = fs.readFileSync(envPath, 'utf8');
        const newModel = message.content.split(' ')[1];
        if (!newModel || newModel === undefined) {
            message.reply(`目前模型: ${process.env.MODEL}`);
            return;
        }
        const updatedContent = envContent.replace(/MODEL=.*/, `MODEL='${newModel}'`);
        fs.writeFileSync(envPath, updatedContent);
        process.env.MODEL = newModel;
        message.reply(`已切換模型為: ${newModel}`);
        console.log(`\x1b[32mChanged model: ${process.env.MODEL}\x1b[0m`);
        return;
    }
    const model = genAI.getGenerativeModel({
        model: process.env.MODEL,
        systemInstruction: fs.readFileSync('./prompt.md', 'utf8'),
        safetySettings: [
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        ],
    });
    const db = new JSONdb('./db/channels.json');
    const channels = db.get('channels') || [];

    const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: "text/plain",
    };

    if (!channels || !channels.includes(message.channel.id) && !message.mentions.has(client.user)) {
        return;
    } else {
        try {
            if (!history[message.channel.id]) history[message.channel.id] = [];
            const chatSession = model.startChat({
                generationConfig,
                history: [
                  ...history[message.channel.id],
                ],
            });

            let imagePart = null;

            if (message.attachments.size > 0) {
                const attachments = message.attachments.filter(attachment => attachment.name.endsWith('.jpg') || attachment.name.endsWith('.png'));
                if (attachments.size > 0) {
                    imagePart = [];
                    for (const attachment of attachments.values()) {
                        const imageResp = await fetch(attachment.url).then((response) => response.arrayBuffer());
                        imagePart.push({
                            inlineData: {
                                data: Buffer.from(imageResp).toString("base64"),
                                mimeType: "image/jpeg",
                            },
                        });
                    }
                }
            }

            message.channel.sendTyping();
            let response;
            if (imagePart !== null) {
                response = await chatSession.sendMessage([`[${message.author.username}]: ${message.content}`, imagePart]);
            } else {
                response = await chatSession.sendMessage([`[${message.author.username}]: ${message.content}`]);
            }
            const result = await response.response.text();
            if (result.length > 2000) {
                message.reply('錯誤: 超出Discord訊息字元限制(2000)');
            } else {
                message.reply(result, { allowedMentions: { parse: ['users'] } });
            }

            history[message.channel.id].push(
                {
                    role: "user",
                    parts: [
                        {
                            text: `[${message.author.username}]: ${message.content}`,
                        },
                        ...(imagePart !== null ? imagePart : []),
                    ],
                },
                {
                    role: "model",
                    parts: [
                        {
                            text: result,
                        },
                    ],
                }
            );
            if (history[message.channel.id].length > 500) {
                history[message.channel.id].shift();
                history[message.channel.id].shift();
            }
            if (imagePart !== null) {
                console.log(`\x1b[36m[${message.author.username}]\x1b[0m: ${message.content} \x1b[32m(image detected)\x1b[0m`);
            } else {
                console.log(`\x1b[36m[${message.author.username}]\x1b[0m: ${message.content}`);
            }
            console.log(`\x1b[36m[model]\x1b[0m: ${result.replace(/\n/g, ' ')} \x1b[90m//history length: ${history[message.channel.id].length}\x1b[0m`);
        } catch (error) {
            if (error.status === 429) {
            console.error('Rate limit exceeded:', error);
            message.reply('目前請求太多(429)，請稍後再試');
            } else if (error.status === 503) {
            console.error('Service unavailable:', error);
            message.reply('服務暫時不可用(503)，請稍後再試');
            } else {
            console.error('Error:', error);
            message.reply(`回應時發生錯誤(${error.status || error})`);
        }
    }
}});

client.login(process.env.TOKEN);

process.on("unhandledRejection", async (error) => {
        console.error(error.stack || error);
});

process.on("uncaughtException", async (error) => {
        console.error(error.stack);
});

process.on("uncaughtExceptionMonitor", async (error) => {
        console.error(error.stack);
});
