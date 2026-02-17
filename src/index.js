require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const express = require('express');
const session = require('express-session');
const path = require('path');
const { startBot } = require('./bot');
const { startWeb } = require('./web');
const prisma = require('./utils/prisma');

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Start Services
(async () => {
    try {
        console.log('🚀 Starting TicketBot System...');
        
        // Start Web Dashboard (Independent of Bot Login)
        startWeb(client).catch(err => console.error('❌ Web Startup Error:', err));

        // Start Bot
        await startBot(client).catch(err => console.error('❌ Bot Startup Error:', err));

    } catch (error) {
        console.error('❌ Critical Startup Error:', error);
    }
})();
