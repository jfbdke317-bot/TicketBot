const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function handleSelectMenu(interaction, client) {
    if (interaction.customId === 'setup_select_channel') {
        const channelId = interaction.values[0];
        
        await interaction.update({ 
            content: `✅ Channel selected: <#${channelId}>\n\nClick **Add Category** to create a button on the panel (e.g. Support, Billing).\nWhen you are done adding categories, click **Finish Setup**.`, 
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`setup_add_cat_${channelId}`).setLabel('Add Category').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`setup_finish_${channelId}`).setLabel('Finish Setup').setStyle(ButtonStyle.Secondary)
                )
            ] 
        });
    }
}

module.exports = { handleSelectMenu };
