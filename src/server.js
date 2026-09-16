'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { pool } = require('./db/pool');
const { attachUser, requireAuth } = require('./middleware/auth');
const { startRefreshJob } = require('./jobs/refreshJob');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const companyRoutes = require('./routes/companies');

const app = express();

// Behind a reverse proxy on the VPS (nginx/Caddy) — trust it so secure
// cookies and rate-limit IP detection work correctly.
app.set('trust proxy', 1);

// Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Static assets
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// Make req.user / res.locals.user available everywhere
app.use(attachUser);

// Config the client needs (stale threshold), exposed to views.
const STALE_AFTER_DAYS = Number(process.env.STALE_AFTER_DAYS) || 30;
app.use((req, res, next) => {
  res.locals.staleAfterDays = STALE_AFTER_DAYS;
  next();
});

// ---- Pages -----------------------------------------------------------------

app.get('/', (req, res) => {
  res.redirect(req.user ? '/dashboard' : '/login');
});

app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const [companiesRes, profileRes] = await Promise.all([
      pool.query(
        'SELECT * FROM companies WHERE user_id = $1 ORDER BY created_at ASC, id ASC',
        [req.user.id]
      ),
      pool.query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]),
    ]);

    const profile = profileRes.rows[0] || {};
    const profileComplete = Boolean(profile.full_name && profile.full_name.trim());

    res.render('dashboard', {
      companies: companiesRes.rows,
      profileComplete,
      staleAfterDays: STALE_AFTER_DAYS,
    });
  } catch (err) {
    console.error('[dashboard] load failed:', err.message);
    res.status(500).render('dashboard', {
      companies: [],
      profileComplete: true,
      staleAfterDays: STALE_AFTER_DAYS,
      loadError: 'Could not load your companies. Please refresh.',
    });
  }
});

// Auth + profile pages
app.use('/', authRoutes);
app.use('/', profileRoutes);

// API
app.use('/api/companies', companyRoutes);

// ---- 404 -------------------------------------------------------------------

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).render('404');
});

// ---- Boot ------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`[server] Attachment Runway listening on port ${PORT}`);
  startRefreshJob();
});
