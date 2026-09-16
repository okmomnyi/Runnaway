-- Attachment Runway schema. Safe to run repeatedly (idempotent).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  contact_email    TEXT NOT NULL DEFAULT '',
  university       TEXT NOT NULL DEFAULT '',
  certifications   TEXT NOT NULL DEFAULT '',
  focus_summary    TEXT NOT NULL DEFAULT '',
  skills           TEXT NOT NULL DEFAULT '',
  cloud_infra      TEXT NOT NULL DEFAULT '',
  recent_activity  TEXT NOT NULL DEFAULT '',
  availability_note TEXT NOT NULL DEFAULT 'Available for an industrial attachment from early May.',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  sector         TEXT NOT NULL DEFAULT 'Other',
  location       TEXT NOT NULL DEFAULT '',
  contact        TEXT NOT NULL DEFAULT '',
  website        TEXT NOT NULL DEFAULT '',
  priority       TEXT NOT NULL DEFAULT 'Medium'
                   CHECK (priority IN ('High','Medium','Low')),
  status         TEXT NOT NULL DEFAULT 'not-applied'
                   CHECK (status IN ('not-applied','applied','pending','interview','accepted','rejected','skip')),
  date_applied   DATE,
  follow_up_date DATE,
  notes          TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('calvin','suggested','manual')),
  is_exception   BOOLEAN NOT NULL DEFAULT false,
  draft_email    TEXT NOT NULL DEFAULT '',
  draft_status   TEXT NOT NULL DEFAULT 'none'
                   CHECK (draft_status IN ('none','generating','ready','failed')),
  site_status    TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (site_status IN ('unknown','ok','broken')),
  last_checked_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_user ON companies(user_id);
CREATE INDEX IF NOT EXISTS idx_companies_user_status ON companies(user_id, status);
