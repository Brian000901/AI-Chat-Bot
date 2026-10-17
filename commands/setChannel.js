const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
    access: 'admin',
    data: new SlashCommandBuilder().setName('setchannel').setDescription('啟用此頻道的 AI 自動回覆').setDMPermission(false),
    async execute(interaction, { channels, queue }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return queue(interaction.channelId, async () => {
            if (channels.has(interaction.channelId)) return interaction.editReply('這個頻道已被設定。');
            channels.add(interaction.channelId);
            await interaction.editReply(`已啟用頻道：<#${interaction.channelId}>`);
        });
    },
};
