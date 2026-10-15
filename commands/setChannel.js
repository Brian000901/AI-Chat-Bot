const { SlashCommandBuilder } = require('discord.js');
module.exports = {
    access: 'admin',
    data: new SlashCommandBuilder().setName('setchannel').setDescription('啟用此頻道的 AI 自動回覆').setDMPermission(false),
    async execute(interaction, { db }) {
        const channels = db.get('channels') || [];
        if (channels.includes(interaction.channelId)) return interaction.editReply('這個頻道已被設定。');
        db.set('channels', [...channels, interaction.channelId]);
        await interaction.editReply(`已啟用頻道：<#${interaction.channelId}>`);
    },
};
