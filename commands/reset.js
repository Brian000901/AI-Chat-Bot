const { SlashCommandBuilder } = require('discord.js');
module.exports = {
    access: 'moderator',
    data: new SlashCommandBuilder().setName('reset').setDescription('清空此頻道的 AI 對話記錄').setDMPermission(false),
    async execute(interaction, { history, queue }) {
        await interaction.deferReply();
        return queue(interaction.channelId, async () => {
            history.delete(interaction.channelId);
            await interaction.editReply('已重置此頻道的對話記錄。');
        });
    },
};
