const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const prisma = require('../utils/prisma');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'supersecretkey',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60000 * 60 * 24 } // 1 day
}));

const DISCORD_API = 'https://discord.com/api/v10';

// Middleware to check auth
const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/');
    next();
};

async function startWeb(client) {
    
    // --- Routes ---
    
    app.get('/', (req, res) => {
        if (req.session.user) return res.redirect('/dashboard');
        
        const redirectUri = encodeURIComponent(`${PUBLIC_URL}/auth/callback`);
        const loginUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&scope=identify+guilds`;

        res.render('login', { loginUrl });
    });

    app.get('/auth/callback', async (req, res) => {
        const { code } = req.query;
        if (!code) return res.redirect('/');

        try {
            const tokenResponse = await axios.post(`${DISCORD_API}/oauth2/token`, new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${PUBLIC_URL}/auth/callback`
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const { access_token, refresh_token } = tokenResponse.data;

            const userResponse = await axios.get(`${DISCORD_API}/users/@me`, {
                headers: { Authorization: `Bearer ${access_token}` }
            });

            const user = userResponse.data;
            req.session.user = user;
            
            // Save user to DB (optional)
            await prisma.user.upsert({
                where: { id: user.id },
                update: { accessToken: access_token, refreshToken: refresh_token },
                create: { 
                    id: user.id, 
                    username: user.username, 
                    accessToken: access_token, 
                    refreshToken: refresh_token 
                }
            });

            res.redirect('/dashboard');

        } catch (error) {
            console.error('Auth Error:', error.response?.data || error.message);
            res.redirect('/?error=auth_failed');
        }
    });

    app.get('/dashboard', requireAuth, async (req, res) => {
        const userId = req.session.user.id;
        
        // Fetch tickets and stats
        const tickets = await prisma.ticket.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        const stats = {
            total: await prisma.ticket.count(),
            open: await prisma.ticket.count({ where: { status: 'OPEN' } }),
            closed: await prisma.ticket.count({ where: { status: 'CLOSED' } })
        };

        const config = await prisma.guildConfig.findFirst();

        // Fetch Guild Info for Settings
        let guildChannels = [];
        let guildCategories = [];
        let guildRoles = [];
        let guildName = 'Unknown Server';

        if (config && config.guildId) {
            const guild = client.guilds.cache.get(config.guildId);
            if (guild) {
                guildName = guild.name;
                guild.channels.cache.forEach(c => {
                    if (c.type === 0) guildChannels.push({ id: c.id, name: c.name }); // Text
                    if (c.type === 4) guildCategories.push({ id: c.id, name: c.name }); // Category
                });
                guild.roles.cache.forEach(r => {
                    if (r.name !== '@everyone') guildRoles.push({ id: r.id, name: r.name });
                });
            }
        } else {
             // Fallback: Use the first guild the bot is in (for initial setup)
             const firstGuild = client.guilds.cache.first();
             if (firstGuild) {
                 guildName = firstGuild.name;
                 firstGuild.channels.cache.forEach(c => {
                    if (c.type === 0) guildChannels.push({ id: c.id, name: c.name });
                    if (c.type === 4) guildCategories.push({ id: c.id, name: c.name });
                 });
                 firstGuild.roles.cache.forEach(r => {
                    if (r.name !== '@everyone') guildRoles.push({ id: r.id, name: r.name });
                });
             }
        }

        // Sort alphabetically
        guildChannels.sort((a, b) => a.name.localeCompare(b.name));
        guildCategories.sort((a, b) => a.name.localeCompare(b.name));
        guildRoles.sort((a, b) => a.name.localeCompare(b.name));

        res.render('dashboard', {
            user: req.session.user,
            tickets,
            stats,
            config: config || {},
            guildName,
            guildChannels,
            guildCategories,
            guildRoles
        });
    });

    app.get('/deploy', requireAuth, async (req, res) => {
        // Find mutual guilds where user has ManageGuild permission
        const guilds = [];
        try {
            // Get user's guilds from Discord API
            const userGuildsResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
                headers: { Authorization: `Bearer ${req.session.user.accessToken}` }
            });
            
            for (const g of userGuildsResponse.data) {
                // Check if bot is in guild
                const guild = client.guilds.cache.get(g.id);
                if (guild) {
                    // Check permissions (0x20 = MANAGE_GUILD, 0x8 = ADMINISTRATOR)
                    // Permissions is a string in the API response
                    const permissions = BigInt(g.permissions);
                    const MANAGE_GUILD = 0x20n;
                    const ADMINISTRATOR = 0x8n;
                    
                    const hasPerms = (permissions & MANAGE_GUILD) === MANAGE_GUILD || (permissions & ADMINISTRATOR) === ADMINISTRATOR;
                    
                    if (hasPerms) {
                        guilds.push({ id: g.id, name: g.name, icon: g.icon });
                    }
                }
            }
        } catch (error) {
            console.error('Failed to fetch user guilds:', error.message);
        }

        res.render('deploy', {
            user: req.session.user,
            guilds
        });
    });

    app.get('/api/guilds/:id/channels', requireAuth, async (req, res) => {
        const guild = client.guilds.cache.get(req.params.id);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });
        
        // Return text channels
        const channels = guild.channels.cache
            .filter(c => c.type === 0) // 0 is GuildText
            .map(c => ({ id: c.id, name: c.name }));
            
        res.json(channels);
    });

    app.post('/api/deploy-panel', requireAuth, async (req, res) => {
        const { guildId, channelId, title, description, color, btnLabel, btnEmoji } = req.body;
        
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).send('Guild not found');
        
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased()) return res.status(404).send('Channel not found');

        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const embed = new EmbedBuilder()
            .setTitle(title || 'Support Ticket')
            .setDescription(description || 'Click below to open a ticket.')
            .setColor(color || '#2b2d31')
            .setFooter({ text: 'Powered by TicketBot' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('open_ticket')
                    .setLabel(btnLabel || 'Open Ticket')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(btnEmoji || '📩')
            );

        try {
            await channel.send({ embeds: [embed], components: [row] });
            res.redirect('/deploy?success=true');
        } catch (error) {
            console.error('Deploy error:', error);
            res.redirect('/deploy?error=failed_to_send');
        }
    });

    app.get('/transcript/:id', async (req, res) => {
        const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
        if (!ticket || !ticket.transcript) return res.status(404).send('Transcript not found');
        res.render('transcript', { ticket });
    });

    app.post('/api/settings', requireAuth, async (req, res) => {
        const { categoryId, roleId, welcomeMsg, transcriptChannelId, guildId } = req.body;
        
        // Basic permission check (allow any logged in user for demo, restrict to owner in prod)
        // Ideally check against client.guilds.cache.get(guildId).members...
        
        // Get guildId from client if not passed (or validate it)
        const targetGuildId = guildId || client.guilds.cache.first()?.id;

        await prisma.guildConfig.upsert({
            where: { id: 'config' },
            update: {
                guildId: targetGuildId,
                ticketCategoryId: categoryId,
                transcriptChannelId: transcriptChannelId,
                supportRoleId: roleId,
                welcomeMessage: welcomeMsg
            },
            create: {
                id: 'config',
                guildId: targetGuildId,
                ticketCategoryId: categoryId,
                transcriptChannelId: transcriptChannelId,
                supportRoleId: roleId,
                welcomeMessage: welcomeMsg
            }
        });
        
        res.redirect('/dashboard?success=saved');
    });

    app.get('/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/');
    });

    app.listen(PORT, () => {
        console.log(`🌍 Web Panel running at http://localhost:${PORT}`);
    });
}

module.exports = { startWeb };
