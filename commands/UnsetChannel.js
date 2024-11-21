const { SlashCommandBuilder } = require('discord.js');
const JSONdb = require('simple-json-db');
const path = require('path');
const db = new JSONdb(path.join(__dirname, '../db/channels.json'));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unsetchannel')
        .setDescription('Unset the channel for the bot to listen to'),
    async execute(interaction) {
        if (interaction.user.id !== '810409750625386497' && !interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }
        
        let channels = db.get('channels') || [];
        
        if (!channels.includes(interaction.channelId)) {
            return await interaction.reply({ content: '當前頻道未被設定', ephemeral: true });
        }

        channels = channels.filter(channelId => channelId !== interaction.channelId);
        db.set('channels', channels);
        
        await interaction.reply({ content: '當前頻道已取消設定' });
    }
};