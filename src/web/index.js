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

        res.render('dashboard', {
            user: req.session.user,
            tickets,
            stats,
            config: config || {}
        });
    });

    app.get('/transcript/:id', async (req, res) => {
        const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
        if (!ticket || !ticket.transcript) return res.status(404).send('Transcript not found');
        res.render('transcript', { ticket });
    });

    app.post('/api/settings', requireAuth, async (req, res) => {
        const { categoryId, roleId, welcomeMsg } = req.body;
        
        // Basic permission check (allow any logged in user for demo, restrict to owner in prod)
        // Ideally check against client.guilds.cache.get(guildId).members...

        await prisma.guildConfig.upsert({
            where: { id: 'config' },
            update: {
                ticketCategoryId: categoryId,
                supportRoleId: roleId,
                welcomeMessage: welcomeMsg
            },
            create: {
                id: 'config',
                ticketCategoryId: categoryId,
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
