const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
    access: 'moderator',
    data: new SlashCommandBuilder().setName('pop').setDescription('移除此頻道最後幾輪對話（一問一答為一輪）').setDMPermission(false)
        .addIntegerOption(option => option.setName('count').setDescription('要刪除的對話輪數').setRequired(true).setMinValue(1).setMaxValue(50)),
    async execute(interaction, { history, queue }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return queue(interaction.channelId, async () => {
            const count = interaction.options.getInteger('count', true);
            const records = history.get(interaction.channelId) || [];
            if (!Number.isInteger(count) || count < 1 || count * 2 > records.length) {
                await interaction.editReply(`數量不正確，目前有 ${records.length / 2} 輪對話。`);
                return;
            }
            records.splice(-count * 2);
            history.set(interaction.channelId, records);
            await interaction.editReply(`已清除最後 ${count} 輪對話。`);
        });
    },
};
