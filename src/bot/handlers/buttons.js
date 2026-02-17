const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const prisma = require('../../utils/prisma');
const { closeTicket } = require('../utils');

async function handleButton(interaction, client) {
    const { customId } = interaction;

    if (customId.startsWith('setup_finish_')) {
        const channelId = customId.split('setup_finish_')[1];
        await interaction.update({ content: `🎉 **Setup Complete!**\nThe ticket panel has been sent to <#${channelId}>.\nYou can now dismiss this message.`, components: [] });
        return;
    }

    if (customId.startsWith('setup_add_cat_')) {
        const channelId = customId.split('setup_add_cat_')[1];
        await interaction.showModal(
            new ModalBuilder()
                .setCustomId(`setup_cat_modal_${channelId}`)
                .setTitle('New Ticket Category')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cat_name').setLabel('Category Name (e.g. Support)').setStyle(TextInputStyle.Short).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cat_emoji').setLabel('Emoji (e.g. 📩)').setStyle(TextInputStyle.Short).setRequired(false)
                    )
                )
        );
        return;
    }

    // Handle Category Buttons dynamically
    if (customId.startsWith('open_cat_')) {
        const catId = customId.split('open_cat_')[1];
        
        // Fetch questions from DB if any
        const category = await prisma.ticketCategory.findUnique({ where: { id: catId } });
        
        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${catId}`)
            .setTitle('Create Ticket');

        if (category && category.questions && Array.isArray(category.questions) && category.questions.length > 0) {
            // Use custom questions
            category.questions.forEach((q, index) => {
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId(`question_${index}`)
                            .setLabel(q.label || `Question ${index + 1}`)
                            .setStyle(q.style === 'Paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                            .setPlaceholder(q.placeholder || '')
                            .setRequired(q.required !== false)
                            .setMinLength(q.minLength || 0)
                            .setMaxLength(q.maxLength || 1000)
                    )
                );
            });
        } else {
            // Default question
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('ticket_reason')
                        .setLabel('Reason for ticket')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                )
            );
        }
        
        await interaction.showModal(modal);
        return;
    }

    if (customId === 'open_ticket') {
        await interaction.showModal(
            new ModalBuilder()
                .setCustomId('ticket_modal')
                .setTitle('Create Ticket')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('ticket_reason')
                            .setLabel('Reason for ticket')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    )
                )
        );
    }

    if (customId === 'close_ticket') {
        const ticket = await prisma.ticket.findUnique({ where: { channelId: interaction.channelId } });
        if (!ticket) return;

        // If ticket is already closing/requesting
        if (ticket.status === 'REQUEST_CLOSE') return interaction.reply({ content: '⚠ Close request already pending.', ephemeral: true });

        // Check if user is staff
        const config = await prisma.guildConfig.findFirst({ where: { guildId: interaction.guildId } });
        const isStaff = config?.supportRoleId && interaction.member.roles.cache.has(config.supportRoleId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (isStaff || isAdmin) {
             // Staff Force Close
             await closeTicket(interaction, ticket, config);
        } else {
            // User Request Close
            await interaction.reply({ 
                content: '❓ Are you sure you want to close this ticket?', 
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('confirm_close').setLabel('Yes, Close').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )
                ] 
            });
        }
    }

    if (customId === 'confirm_close') {
         const ticket = await prisma.ticket.findUnique({ where: { channelId: interaction.channelId } });
         const config = await prisma.guildConfig.findFirst({ where: { guildId: interaction.guildId } });
         await closeTicket(interaction, ticket, config);
    }

    if (customId === 'cancel_close') {
        await interaction.message.delete();
    }

    if (customId === 'claim_ticket') {
        await interaction.deferUpdate();
        const ticket = await prisma.ticket.findUnique({ where: { channelId: interaction.channelId } });
        
        if (ticket.claimedBy) {
            return interaction.followUp({ content: '❌ Ticket is already claimed.', ephemeral: true });
        }

        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { claimedBy: interaction.user.id }
        });

        const embed = new EmbedBuilder()
            .setDescription(`✅ Ticket claimed by ${interaction.user}`)
            .setColor('#00ff00');
            
        await interaction.channel.send({ embeds: [embed] });
    }
}

module.exports = { handleButton };
