const prisma = require('../utils/prisma');
const discordTranscripts = require('discord-html-transcripts');

async function closeTicket(interaction, ticket, config) {
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '🔒 Closing ticket...', ephemeral: true });
    else await interaction.followUp({ content: '🔒 Closing ticket...', ephemeral: true });

    const { EmbedBuilder } = require('discord.js');

    // Generate HTML Transcript
    const attachment = await discordTranscripts.createTranscript(interaction.channel, {
        limit: -1, // Export all messages
        returnType: 'attachment', // Return attachment builder
        filename: `transcript-${ticket.channelId}.html`,
        saveImages: true,
        footerText: "Exported {number} message{s}", 
        poweredBy: false
    });
    
    // Convert attachment buffer to string for DB storage
    const transcriptString = attachment.attachment.toString('utf-8');

    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { 
            status: 'CLOSED', 
            closedAt: new Date(), 
            transcript: transcriptString, // Save HTML string to DB
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
                    
                // Send file attachment to log channel too
                await logChannel.send({ embeds: [logEmbed], files: [attachment] });
            }
        } catch (err) {
            console.error('Failed to send transcript log:', err);
        }
    }

    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}

module.exports = { closeTicket };
