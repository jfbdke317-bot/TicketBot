const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    PermissionFlagsBits, 
    REST, 
    Routes, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    InteractionType
} = require('discord.js');
const prisma = require('../utils/prisma');
const fs = require('fs');
const path = require('path');

let clientRef;

const COMMANDS = [
    {
        name: 'setup-ticket',
        description: 'Send the ticket panel to the current channel',
        default_member_permissions: PermissionFlagsBits.Administrator.toString()
    },
    {
        name: 'add-user',
        description: 'Add a user to the ticket',
        options: [{
            name: 'user',
            type: 6, // USER
            description: 'The user to add',
            required: true
        }]
    },
    {
        name: 'remove-user',
        description: 'Remove a user from the ticket',
        options: [{
            name: 'user',
            type: 6, // USER
            description: 'The user to remove',
            required: true
        }]
    },
    {
        name: 'ban-user',
        description: 'Ban a user from creating tickets',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
        options: [
            {
                name: 'user',
                type: 6, // USER
                description: 'The user to ban',
                required: true
            },
            {
                name: 'reason',
                type: 3, // STRING
                description: 'Reason for ban',
                required: false
            }
        ]
    },
    {
        name: 'unban-user',
        description: 'Unban a user from creating tickets',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
        options: [{
            name: 'user',
            type: 6, // USER
            description: 'The user to unban',
            required: true
        }]
    }
];

async function startBot(client) {
    clientRef = client;
    
    client.once('ready', async () => {
        console.log(`🤖 Bot logged in as ${client.user.tag}`);
        
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        try {
            console.log('Started refreshing application (/) commands.');
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: COMMANDS },
            );
            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error(error);
        }
    });

    client.on('interactionCreate', async interaction => {
        try {
            if (interaction.isChatInputCommand()) return handleCommand(interaction);
            if (interaction.isButton()) return handleButton(interaction);
            if (interaction.isModalSubmit()) return handleModal(interaction);
        } catch (error) {
            console.error('Interaction Error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An error occurred.', ephemeral: true }).catch(() => {});
            }
        }
    });

    await client.login(process.env.DISCORD_TOKEN);
}

async function handleCommand(interaction) {
    const { commandName } = interaction;

    if (commandName === 'setup-ticket') {
        const embed = new EmbedBuilder()
            .setTitle('🎫 Support Tickets')
            .setDescription('Click the button below to open a support ticket.\n\nOur team will assist you as soon as possible.')
            .setColor('#2b2d31')
            .setFooter({ text: 'Powered by TicketBot' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('open_ticket')
                    .setLabel('Open Ticket')
                    .setEmoji('📩')
                    .setStyle(ButtonStyle.Primary)
            );

        await interaction.reply({ content: '✅ Panel sent!', ephemeral: true });
        await interaction.channel.send({ embeds: [embed], components: [row] });
    }

    if (commandName === 'add-user') {
        const ticket = await prisma.ticket.findUnique({ where: { channelId: interaction.channelId } });
        if (!ticket || ticket.status === 'CLOSED') {
            return interaction.reply({ content: '❌ This is not an open ticket channel.', ephemeral: true });
        }
        const user = interaction.options.getUser('user');
        await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true });
        await interaction.reply({ content: `✅ Added ${user} to the ticket.` });
    }
    
    if (commandName === 'remove-user') {
         const ticket = await prisma.ticket.findUnique({ where: { channelId: interaction.channelId } });
        if (!ticket || ticket.status === 'CLOSED') {
            return interaction.reply({ content: '❌ This is not an open ticket channel.', ephemeral: true });
        }
        const user = interaction.options.getUser('user');
        await interaction.channel.permissionOverwrites.delete(user.id);
        await interaction.reply({ content: `✅ Removed ${user} from the ticket.` });
    }

    if (commandName === 'ban-user') {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        await prisma.user.upsert({
            where: { id: user.id },
            update: { isBanned: true, banReason: reason },
            create: { id: user.id, username: user.username, isBanned: true, banReason: reason }
        });

        await interaction.reply({ content: `🚫 Banned ${user} from using tickets.\nReason: ${reason}`, ephemeral: true });
    }

    if (commandName === 'unban-user') {
        const user = interaction.options.getUser('user');
        
        await prisma.user.update({
            where: { id: user.id },
            data: { isBanned: false, banReason: null }
        }).catch(() => {}); // Ignore if user not found

        await interaction.reply({ content: `✅ Unbanned ${user}.`, ephemeral: true });
    }
}

const { closeTicket } = require('./utils');

async function handleButton(interaction) {
    const { customId } = interaction;

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

        // If staff/admin clicks close -> force close or request?
        // Let's implement: User clicks -> Request Close (if enabled), Staff clicks -> Force Close
        
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

async function handleModal(interaction) {
    if (interaction.customId === 'ticket_modal') {
        await interaction.deferReply({ ephemeral: true });
        
        // Check Ban Status
        const userRecord = await prisma.user.findUnique({ where: { id: interaction.user.id } });
        if (userRecord && userRecord.isBanned) {
            return interaction.editReply({ content: `❌ You are banned from creating tickets.\nReason: ${userRecord.banReason || 'No reason'}` });
        }

        const reason = interaction.fields.getTextInputValue('ticket_reason');
        const guild = interaction.guild;

        // Find or create GuildConfig
        let config = await prisma.guildConfig.findFirst({ where: { guildId: guild.id } });
        
        // Create Channel
        const channelName = `ticket-${interaction.user.username.replace(/[^a-zA-Z0-9]/g, '')}`.slice(0, 25);
        
        const parent = config?.ticketCategoryId || null;
        
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
                        id: clientRef.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]
                    }
                    // Add Staff role overwrite if configured
                ]
            });

            await prisma.ticket.create({
                data: {
                    channelId: channel.id,
                    guildId: guild.id,
                    openerId: interaction.user.id,
                    status: 'OPEN'
                }
            });

            const embed = new EmbedBuilder()
                .setTitle(`Ticket: ${interaction.user.tag}`)
                .setDescription(`**Reason:**\n${reason}\n\nSupport will be with you shortly.`)
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

module.exports = { startBot };
