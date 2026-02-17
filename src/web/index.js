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
        
        // OAuth2 URL for inviting the bot (Admin permissions)
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;

        res.render('login', { loginUrl, inviteUrl });
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
        
        // Invite Link
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;

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

        // --- Fetch Guilds Logic ---
        let availableGuilds = [];
        let selectedGuild = null;

        try {
            // 1. Get User's Guilds
            const userGuildsResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
                headers: { Authorization: `Bearer ${req.session.user.accessToken}` }
            });

            // 2. Filter for mutual guilds with permissions
            for (const g of userGuildsResponse.data) {
                const guild = client.guilds.cache.get(g.id);
                if (guild) {
                    const permissions = BigInt(g.permissions);
                    const MANAGE_GUILD = 0x20n;
                    const ADMINISTRATOR = 0x8n;
                    const hasPerms = (permissions & MANAGE_GUILD) === MANAGE_GUILD || (permissions & ADMINISTRATOR) === ADMINISTRATOR;
                    
                    if (hasPerms) {
                        availableGuilds.push({ id: g.id, name: g.name, icon: g.icon });
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching user guilds:', error.message);
        }

        // 3. Determine which guild to show
        let targetGuildId = req.query.guild || (config ? config.guildId : null);
        
        if (targetGuildId) {
             const found = availableGuilds.find(g => g.id === targetGuildId);
             if (found) {
                 selectedGuild = client.guilds.cache.get(targetGuildId);
             }
        }

        // Fallback if no valid selection
        if (!selectedGuild && availableGuilds.length > 0) {
            selectedGuild = client.guilds.cache.get(availableGuilds[0].id);
        }

        // Fetch Guild Info for Settings (Channels/Roles)
        let guildChannels = [];
        let guildCategories = [];
        let guildRoles = [];
        let guildName = 'No Server Found';

        if (selectedGuild) {
            guildName = selectedGuild.name;
            selectedGuild.channels.cache.forEach(c => {
                if (c.type === 0) guildChannels.push({ id: c.id, name: c.name }); // Text
                if (c.type === 4) guildCategories.push({ id: c.id, name: c.name }); // Category
            });
            selectedGuild.roles.cache.forEach(r => {
                if (r.name !== '@everyone') guildRoles.push({ id: r.id, name: r.name });
            });
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
            inviteUrl,
            guildName,
            guildChannels,
            guildCategories,
            guildRoles,
            availableGuilds,     // Pass list of servers to frontend
            selectedGuildId: selectedGuild ? selectedGuild.id : null
        });
    });

    app.get('/settings', requireAuth, async (req, res) => {
        // Invite Link
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;

        // Similar Guild Fetching Logic as Dashboard (Refactor into a helper function later)
        let availableGuilds = [];
        let selectedGuild = null;

        try {
            const userGuildsResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
                headers: { Authorization: `Bearer ${req.session.user.accessToken}` }
            });

            for (const g of userGuildsResponse.data) {
                const guild = client.guilds.cache.get(g.id);
                if (guild) {
                    const permissions = BigInt(g.permissions);
                    const MANAGE_GUILD = 0x20n;
                    const ADMINISTRATOR = 0x8n;
                    const hasPerms = (permissions & MANAGE_GUILD) === MANAGE_GUILD || (permissions & ADMINISTRATOR) === ADMINISTRATOR;
                    
                    if (hasPerms) {
                        availableGuilds.push({ id: g.id, name: g.name, icon: g.icon });
                    }
                }
            }
        } catch (error) { console.error(error); }

        const config = await prisma.guildConfig.findFirst();
        let targetGuildId = req.query.guild || (config ? config.guildId : null);
        
        if (targetGuildId) {
             const found = availableGuilds.find(g => g.id === targetGuildId);
             if (found) {
                 selectedGuild = client.guilds.cache.get(targetGuildId);
             }
        }
        if (!selectedGuild && availableGuilds.length > 0) {
            selectedGuild = client.guilds.cache.get(availableGuilds[0].id);
        }

        let guildChannels = [];
        let guildCategories = [];
        let guildRoles = [];
        
        if (selectedGuild) {
            selectedGuild.channels.cache.forEach(c => {
                if (c.type === 0) guildChannels.push({ id: c.id, name: c.name });
                if (c.type === 4) guildCategories.push({ id: c.id, name: c.name });
            });
            selectedGuild.roles.cache.forEach(r => {
                if (r.name !== '@everyone') guildRoles.push({ id: r.id, name: r.name });
            });
        }
        
        guildChannels.sort((a, b) => a.name.localeCompare(b.name));
        guildCategories.sort((a, b) => a.name.localeCompare(b.name));
        guildRoles.sort((a, b) => a.name.localeCompare(b.name));

        res.render('settings', {
            user: req.session.user,
            config: config || {},
            inviteUrl,
            availableGuilds,
            selectedGuildId: selectedGuild ? selectedGuild.id : null,
            guildChannels,
            guildCategories,
            guildRoles
        });
    });

    app.get('/tickets', requireAuth, async (req, res) => {
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;
        
        // Pagination & Filtering
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const statusFilter = req.query.status || undefined;
        const search = req.query.search || undefined;

        const where = {};
        if (statusFilter) where.status = statusFilter;
        if (search) where.OR = [
            { id: { contains: search } },
            { channelId: { contains: search } },
            { openerId: { contains: search } }
        ];

        const tickets = await prisma.ticket.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit
        });

        const totalTickets = await prisma.ticket.count({ where });

        res.render('tickets', {
            user: req.session.user,
            tickets,
            inviteUrl,
            currentPage: page,
            totalPages: Math.ceil(totalTickets / limit),
            statusFilter,
            search
        });
    });

    app.get('/deploy', requireAuth, async (req, res) => {
        // Invite Link
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;

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
            guilds,
            inviteUrl
        });
    });

    // --- New API Endpoints for Channel/Category Creation ---

    app.post('/api/create-category', requireAuth, async (req, res) => {
        const { guildId, name } = req.body;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).send('Guild not found');
        
        try {
            const { ChannelType } = require('discord.js');
            await guild.channels.create({
                name: name,
                type: ChannelType.GuildCategory
            });
            res.redirect(`/dashboard?guild=${guildId}&success=category_created`);
        } catch (error) {
            console.error('Create Category Error:', error);
            res.redirect(`/dashboard?guild=${guildId}&error=failed_create`);
        }
    });

    app.post('/api/create-channel', requireAuth, async (req, res) => {
        const { guildId, name, parentId } = req.body;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).send('Guild not found');
        
        try {
            const { ChannelType } = require('discord.js');
            await guild.channels.create({
                name: name,
                type: ChannelType.GuildText,
                parent: parentId || null
            });
            res.redirect(`/dashboard?guild=${guildId}&success=channel_created`);
        } catch (error) {
            console.error('Create Channel Error:', error);
            res.redirect(`/dashboard?guild=${guildId}&error=failed_create`);
        }
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
        const { categoryId, roleId, welcomeMsg, transcriptChannelId, guildId, maxTickets, autoCloseHours } = req.body;
        
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
                welcomeMessage: welcomeMsg,
                maxTickets: parseInt(maxTickets) || 1,
                autoCloseHours: parseInt(autoCloseHours) || 24
            },
            create: {
                id: 'config',
                guildId: targetGuildId,
                ticketCategoryId: categoryId,
                transcriptChannelId: transcriptChannelId,
                supportRoleId: roleId,
                welcomeMessage: welcomeMsg,
                maxTickets: parseInt(maxTickets) || 1,
                autoCloseHours: parseInt(autoCloseHours) || 24
            }
        });
        
        res.redirect('/settings?guild=' + targetGuildId + '&success=saved');
    });

    app.post('/api/delete-category', requireAuth, async (req, res) => {
        const { categoryId, guildId } = req.body;
        // Permission check...
        
        try {
            await prisma.ticketCategory.delete({ where: { id: categoryId } });
            res.sendStatus(200);
        } catch (error) {
            console.error('Delete Category Error:', error);
            res.sendStatus(500);
        }
    });

    app.post('/api/create-category-settings', requireAuth, async (req, res) => {
        const { name, emoji, guildId } = req.body;
        
        try {
            let config = await prisma.guildConfig.findFirst({ where: { guildId } });
            if (!config) {
                config = await prisma.guildConfig.create({ data: { guildId, id: 'config' } });
            }

            await prisma.ticketCategory.create({
                data: {
                    configId: config.id,
                    name,
                    emoji
                }
            });
            res.sendStatus(200);
        } catch (error) {
            console.error('Create Category Error:', error);
            res.sendStatus(500);
        }
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
