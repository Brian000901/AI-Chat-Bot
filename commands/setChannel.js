const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const JSONdb = require('simple-json-db');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../db/channels.json');
if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, '{}');
}

const db = new JSONdb(dbPath);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set the channel for the bot to listen to'),
    async execute(interaction) {
        if (interaction.user.id !== '810409750625386497' && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await interaction.reply({ content: '你沒有權限使用此指令.', ephemeral: true });
        }

        db.JSON();
        let channels = db.get('channels') || [];
        if (channels.includes(interaction.channelId)) {
            return await interaction.reply({ content: '這個頻道已被設定', ephemeral: true });
        }

        channels.push(interaction.channelId);
        db.set('channels', channels);

        await interaction.reply(`成功設定頻道: <#${interaction.channelId}>`);
    },
};