const { SlashCommandBuilder } = require('discord.js');
const JSONdb = require('simple-json-db');
const path = require('path');
const db = new JSONdb(path.join(__dirname, '../db/channels.json'));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set the channel for the bot to listen to'),
    async execute(interaction) {
        if (interaction.user.id !== '810409750625386497' && !interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }
        
        const channels = db.get('channels') || [];
        if (channels.includes(interaction.channelId)) {
            return await interaction.reply({ content: '這個頻道已被設定', ephemeral: true });
        }

        channels.push(interaction.channelId);
        db.set('channels', channels);
        await interaction.reply(`成功設定頻道: <#${interaction.channelId}>`);
    }
};