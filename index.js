const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
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

// 將每個指令載入到 client.commands 集合中
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

// 將所有指令的 data 屬性轉換為 JSON 格式
const commands = commandFiles.map(file => {
    const command = require(`./commands/${file}`);
    return command.data.toJSON();
});

// 創建 REST 實例並設置 token
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
const model = genAI.getGenerativeModel({ model: process.env.MODEL });
client.on('messageCreate', async message => {
    if (message.author.id === client.user.id) return;
    const db = new JSONdb('./db/channels.json');
    const channels = db.get('channels') || [];
    if (!channels || !channels.includes(message.channel.id)) {
        return;
    } else {
        try {
            // Show typing indicator
            message.channel.sendTyping();
            const response = await model.generateContent(message.content);
            const result = await response.response.text();
            if (result.length > 2000) {
                message.reply('錯誤: 超出Discord訊息字元限制(2000)');
            } else {
                message.reply(result);
            }
        } catch (error) {
            if (error.status === 429) {
            console.error('Rate limit exceeded:', error);
            message.reply('抱歉，目前請求太多(429)，請稍後再試');
            } else if (error.status === 503) {
            console.error('Service unavailable:', error);
            message.reply('抱歉，服務暫時不可用(503)，請稍後再試');
            } else {
            console.error('Error:', error);
            message.reply(`回應時發生錯誤(${error.status || '未知'}),請稍後再試`);
        }
    }
}});

client.login(process.env.TOKEN);
