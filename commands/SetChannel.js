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
        db.set('channel', interaction.channelId);
        await interaction.reply(`Channel set to <#${interaction.channelId}>`);
    }
};