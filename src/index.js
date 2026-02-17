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
        
        // Start Bot
        await startBot(client);
        
        // Start Web Dashboard
        await startWeb(client);

    } catch (error) {
        console.error('❌ Startup Error:', error);
    }
})();
