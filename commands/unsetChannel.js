const { SlashCommandBuilder } = require('discord.js');
module.exports = {
    access: 'admin',
    data: new SlashCommandBuilder().setName('unsetchannel').setDescription('關閉此頻道的 AI 自動回覆').setDMPermission(false),
    async execute(interaction, { db }) {
        const channels = db.get('channels') || [];
        if (!channels.includes(interaction.channelId)) return interaction.editReply('此頻道尚未啟用。');
        db.set('channels', channels.filter(id => id !== interaction.channelId));
        await interaction.editReply('已關閉此頻道的 AI 自動回覆。');
    },
};
