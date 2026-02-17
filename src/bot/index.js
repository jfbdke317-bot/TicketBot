const { Client, REST, Routes } = require('discord.js');
const { COMMANDS, handleCommand } = require('./handlers/commands');
const { handleButton } = require('./handlers/buttons');
const { handleModal } = require('./handlers/modals');
const { handleSelectMenu } = require('./handlers/selects');

async function startBot(client) {
    
    client.once('clientReady', async () => {
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
            if (interaction.isChatInputCommand()) return handleCommand(interaction, client);
            if (interaction.isButton()) return handleButton(interaction, client);
            if (interaction.isStringSelectMenu()) return handleSelectMenu(interaction, client);
            if (interaction.isModalSubmit()) return handleModal(interaction, client);
        } catch (error) {
            console.error('Interaction Error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An error occurred.', ephemeral: true }).catch(() => {});
            }
        }
    });

    await client.login(process.env.DISCORD_TOKEN);
}

module.exports = { startBot };
