const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
    access: 'admin',
    data: new SlashCommandBuilder().setName('unsetchannel').setDescription('關閉此頻道的 AI 自動回覆').setDMPermission(false),
    async execute(interaction, { channels, queue }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return queue(interaction.channelId, async () => {
            if (!channels.has(interaction.channelId)) return interaction.editReply('此頻道尚未啟用。');
            channels.delete(interaction.channelId);
            await interaction.editReply('已關閉此頻道的 AI 自動回覆。');
        });
    },
};
