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
}

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
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
             // Optional: Check if user is ticket owner
             // For now, allow staff only or owner
        }

        await interaction.reply({ content: '🔒 Closing ticket...', ephemeral: true });
        
        const ticket = await prisma.ticket.findUnique({ where: { channelId: interaction.channelId } });
        if (!ticket) return;

        // Generate Transcript
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const transcript = messages.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
        
        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { 
                status: 'CLOSED', 
                closedAt: new Date(), 
                transcript: transcript,
                closedBy: interaction.user.id
            }
        });

        // Send transcript to user?
        // Delete channel
        
        // Find GuildConfig for transcript channel
        const config = await prisma.guildConfig.findFirst({ where: { guildId: interaction.guildId } });
        if (config && config.transcriptChannelId) {
            try {
                const logChannel = await interaction.guild.channels.fetch(config.transcriptChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle(`📄 Ticket Closed: ${ticket.channelId}`)
                        .addFields(
                            { name: 'Opener', value: `<@${ticket.openerId}>`, inline: true },
                            { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Transcript', value: `[View Online](${process.env.PUBLIC_URL}/transcript/${ticket.id})`, inline: false }
                        )
                        .setColor('#ff0000')
                        .setTimestamp();
                        
                    await logChannel.send({ embeds: [logEmbed] });
                }
            } catch (err) {
                console.error('Failed to send transcript log:', err);
            }
        }

        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
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
