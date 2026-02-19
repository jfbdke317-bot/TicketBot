const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const prisma = require('../../utils/prisma');

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
    },
    {
        name: 'setup-panel',
        description: 'Start interactive setup wizard for ticket panel',
        default_member_permissions: PermissionFlagsBits.Administrator.toString()
    }
];

async function handleCommand(interaction, client) {
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
        await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
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
    if (commandName === 'setup-panel') {
        // Step 1: Ask for channel
        const channels = interaction.guild.channels.cache
            .filter(c => c.type === ChannelType.GuildText)
            .first(25) // Discord limit for select menu
            .map(c => ({ label: `#${c.name}`, value: c.id }));

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('setup_select_channel')
                    .setPlaceholder('Select a channel for the panel')
                    .addOptions(channels)
            );

        await interaction.reply({ content: 'Step 1: Where should the ticket panel be sent?', components: [row], ephemeral: true });
    }
}

module.exports = { COMMANDS, handleCommand };
