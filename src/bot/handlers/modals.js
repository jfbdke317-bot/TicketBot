const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const prisma = require('../../utils/prisma');

async function handleModal(interaction, client) {
    if (interaction.customId.startsWith('setup_cat_modal_')) {
        const targetChannelId = interaction.customId.split('setup_cat_modal_')[1];
        const name = interaction.fields.getTextInputValue('cat_name');
        const emoji = interaction.fields.getTextInputValue('cat_emoji') || '📩';

        // Save Category to DB
        let config = await prisma.guildConfig.findFirst({ where: { guildId: interaction.guildId } });
        if (!config) {
            config = await prisma.guildConfig.create({ data: { guildId: interaction.guildId, id: interaction.guildId } });
        }

        await prisma.ticketCategory.create({
            data: {
                configId: config.id,
                name,
                emoji
            }
        });

        // Send Panel Update
        const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
        if (targetChannel) {
            // Fetch all categories
            const allCats = await prisma.ticketCategory.findMany({ where: { configId: config.id } });
            
            const embed = new EmbedBuilder()
                .setTitle('🎫 Support Tickets')
                .setDescription('Select a category below to open a ticket.')
                .setColor('#2b2d31');

            // Split categories into chunks of 5 (Discord ActionRow Limit)
            const rows = [];
            for (let i = 0; i < allCats.length; i += 5) {
                const chunk = allCats.slice(i, i + 5);
                const row = new ActionRowBuilder();
                chunk.forEach(cat => {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`open_cat_${cat.id}`)
                            .setLabel(cat.name.slice(0, 80))
                            .setEmoji(cat.emoji || '📩')
                            .setStyle(ButtonStyle.Primary)
                    );
                });
                rows.push(row);
            }

            if (rows.length > 5) {
                rows.length = 5; 
            }

            await targetChannel.send({ embeds: [embed], components: rows });
            
            await interaction.reply({ 
                content: `✅ Added category **${name}**!\nDo you want to add another one?`, 
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`setup_add_cat_${targetChannelId}`).setLabel('Add Another Category').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`setup_finish_${targetChannelId}`).setLabel('Finish Setup').setStyle(ButtonStyle.Secondary)
                    )
                ],
                ephemeral: true 
            });
        }
        return;
    }

    if (interaction.customId.startsWith('ticket_modal_') || interaction.customId === 'ticket_modal') {
        await interaction.deferReply({ ephemeral: true });
        
        const catId = interaction.customId.startsWith('ticket_modal_') ? interaction.customId.split('ticket_modal_')[1] : null;

        // Check Ban Status
        const userRecord = await prisma.user.findUnique({ where: { id: interaction.user.id } });
        if (userRecord && userRecord.isBanned) {
            return interaction.editReply({ content: `❌ You are banned from creating tickets.\nReason: ${userRecord.banReason || 'No reason'}` });
        }

        let reason = '';
        let fields = [];

        // Try to get 'ticket_reason' first
        try {
            reason = interaction.fields.getTextInputValue('ticket_reason');
        } catch (e) {
            // If not found, it might be dynamic questions
            // We iterate over the fields in the submission
            interaction.fields.fields.forEach((field) => {
                fields.push({ id: field.customId, value: field.value });
            });
            // Construct reason from fields
            reason = fields.map(f => `**${f.id}**: ${f.value}`).join('\n');
        }

        const guild = interaction.guild;

        // Find or create GuildConfig
        let config = await prisma.guildConfig.findFirst({ where: { guildId: guild.id } });
        
        // Determine Parent Category (Discord Channel ID)
        let parent = config?.ticketCategoryId || null;
        let catName = 'ticket';

        if (catId) {
            const ticketCat = await prisma.ticketCategory.findUnique({ where: { id: catId } });
            if (ticketCat) {
                if (ticketCat.discordCategoryId) parent = ticketCat.discordCategoryId;
                catName = ticketCat.name.toLowerCase();
            }
        }
        
        // Create Channel
        // Use naming scheme if available
        // Default: ticket-{username}
        let channelName = `${catName}-${interaction.user.username.replace(/[^a-zA-Z0-9]/g, '')}`.slice(0, 25);
        
        try {
            const channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: parent,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]
                    }
                    // Add Staff role overwrite if configured
                ]
            });

            // Add Staff Role permissions
            if (config && config.supportRoleId) {
                try {
                    await channel.permissionOverwrites.create(config.supportRoleId, {
                        ViewChannel: true,
                        SendMessages: true,
                        AttachFiles: true
                    });
                } catch (e) {
                    console.error('Failed to add support role permissions:', e);
                }
            }

            await prisma.ticket.create({
                data: {
                    channelId: channel.id,
                    guildId: guild.id,
                    openerId: interaction.user.id,
                    status: 'OPEN',
                    type: catName
                }
            });

            const embed = new EmbedBuilder()
                .setTitle(`Ticket: ${interaction.user.tag}`)
                .setDescription(`**Category:** ${catName}\n**Details:**\n${reason}\n\nSupport will be with you shortly.`)
                .setColor('#2b2d31')
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                    new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Secondary).setEmoji('🙋‍♂️')
                );

            await channel.send({ content: `${interaction.user}`, embeds: [embed], components: [row] });

            await interaction.editReply({ content: `✅ Ticket created: ${channel}` });

        } catch (error) {
            console.error('Failed to create ticket channel:', error);
            await interaction.editReply({ content: '❌ Failed to create ticket channel. Please contact an admin.' });
        }
    }
}

module.exports = { handleModal };
