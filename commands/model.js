const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
    access: 'owner',
    data: new SlashCommandBuilder().setName('model').setDescription('查看或切換 AI 模型（僅機器人擁有者）').setDMPermission(false)
        .addStringOption(option => option.setName('name').setDescription('模型名稱，留空查看目前模型').setMaxLength(120)),
    async execute(interaction, { setModel, queue }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return queue(interaction.channelId, async () => {
            const name = interaction.options.getString('name');
            if (name) setModel(name);
            await interaction.editReply(`目前模型：${process.env.MODEL}`);
        });
    },
};
