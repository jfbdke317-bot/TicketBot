
const prisma = require('../utils/prisma');

async function closeTicket(interaction, ticket, config) {
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '🔒 Closing ticket...', ephemeral: true });
    else await interaction.followUp({ content: '🔒 Closing ticket...', ephemeral: true });

    const { EmbedBuilder } = require('discord.js'); // Re-import to ensure scope

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

    // Send Transcript Log
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

module.exports = { closeTicket };
