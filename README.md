# Attachment Runway

A self-hosted tracker for internship / industrial-attachment applications,
with AI-drafted cold emails. You register a private account, keep a list of
target companies with their status and notes, and — when you're ready to reach
out — generate a personalised cold email drafted from **your own** profile
details. Nothing is ever sent for you; you review and send every email
yourself.

Built for Nairobi & Mombasa attachment hunting, but the code contains no
hardcoded personal data — your details go in through the profile form after
setup, so anyone can clone it and use it for their own search.

## Features

- Email + password accounts (bcrypt-hashed), JWT session in an httpOnly cookie.
- Company tracker with status, priority, sector, dates, and free-text notes —
  every edit saves instantly via a small JSON API, no page reloads.
- Search and filter by name/location, sector, status, and priority.
- AI-drafted cold emails via NVIDIA's free OpenAI-compatible API, called only
  from the server. Drafts use only the skills and background you enter — no
  invented experience.
- A weekly background job re-checks each company's website is reachable and
  stamps `last_checked_at`. The UI flags anything unchecked for 30+ days as
  "needs re-verification", and flags links that failed their last check.
- Light and dark mode, responsive down to phone width.

### An honest note on "regularly updated"

This app verifies that each company's **website is still reachable** on a
weekly schedule. It does **not** claim to know live hiring or attachment-vacancy
status — no free model can reliably confirm that, and doing it properly needs a
paid search API. Treat the seed list as a research starting point and confirm
current openings yourself through each company's careers channel.

## Prerequisites

- **Node.js 18+** (for the built-in `fetch`).
- A free **Neon** Postgres database — <https://neon.tech>. Create a project and
  copy its connection string.
- A free **NVIDIA API key** for drafting — <https://build.nvidia.com>. (The app
  runs fine without it; the "Draft email" button simply reports that drafting
  isn't configured.)

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    then edit .env — set DATABASE_URL, JWT_SECRET, and (optionally) NVIDIA_API_KEY.
#    Generate a strong secret:
#    node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Create the database tables
npm run migrate

# 4. Start the app
npm run dev
```

Then open <http://localhost:3000>, **register an account** through the web UI,
and fill in your profile.

### Loading the starter company list (optional)

The repo ships with a curated list of Nairobi & Mombasa companies. To load it
into your account, register first, then run the seed with your account email:

```bash
npm run seed -- your@email.com
```

The seed is safe to re-run — it only inserts if that account currently has zero
companies, so it never creates duplicates.

## Docker / VPS deployment

The database is Neon (remote), so there's no local Postgres container — the app
is a single service that reads `DATABASE_URL` from your `.env`.

```bash
# Build and start
docker compose up -d --build

# Create the tables (first deploy only)
docker compose exec app npm run migrate

# Optionally load the starter list for your account
docker compose exec app npm run seed -- your@email.com
```

Put the app behind a reverse proxy (nginx / Caddy) that terminates HTTPS, and
set `COOKIE_SECURE=true` in `.env` once you're serving over HTTPS so the auth
cookie is only sent over secure connections.

## How the weekly refresh job works

On boot, the server schedules a [node-cron](https://www.npmjs.com/package/node-cron)
job using `CRON_SCHEDULE` (default `0 3 * * 1` — 3am every Monday). It walks
every company that has a website, makes a `HEAD` request (falling back to `GET`)
with an 8-second timeout, and records `ok` / `broken` plus `last_checked_at`.
A company whose last check is older than `STALE_AFTER_DAYS` (default 30) is
flagged in the UI as "needs re-verification". The staleness is computed live
from the timestamp, not stored as a separate flag.

## Configuration reference

All configuration is via environment variables — see [`.env.example`](.env.example)
for the fully commented list. Key ones:

| Variable         | Purpose                                                        |
| ---------------- | ------------------------------------------------------------- |
| `DATABASE_URL`   | Neon Postgres connection string (SSL required).               |
| `JWT_SECRET`     | Signs auth cookies. **Use a long, random value.**             |
| `COOKIE_SECURE`  | `true` once behind HTTPS; `false` for local / plain HTTP.     |
| `NVIDIA_API_KEY` | Enables AI drafting. Omit to disable that feature.            |
| `CRON_SCHEDULE`  | When the weekly link-check runs.                              |
| `STALE_AFTER_DAYS` | Days before a company is flagged "needs re-verification".   |

## Security notes

- **Set a strong `JWT_SECRET`.** Anyone who knows it can forge login cookies.
- **Never commit `.env`.** It's already in `.gitignore`; keep it that way.
- Passwords are hashed with bcrypt (cost 12) and never stored in plain text.
- The NVIDIA API key is used server-side only and is never exposed to the
  browser.
- Turn on `COOKIE_SECURE=true` in production behind HTTPS.

## Project layout

```
src/
  server.js            Express app + boot
  db/                  schema, pool, migrate, seed, seed-companies
  middleware/auth.js   JWT cookie auth
  routes/              auth, companies (JSON API), profile
  services/            nvidia (drafting), linkChecker
  jobs/refreshJob.js   weekly link-check cron
  views/               EJS templates
  public/              CSS, client JS, favicon
```

## Implementation note

This project uses [`bcryptjs`](https://www.npmjs.com/package/bcryptjs) — a pure
JavaScript bcrypt implementation — rather than the native `bcrypt` addon, so it
installs and runs cleanly on any platform (Windows, Alpine Docker, etc.) with no
build toolchain. It's a drop-in with the same hashing scheme.

## License

MIT.
