'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// DB path is configurable so it can live on a mounted persistent disk in the cloud (e.g. Render /data).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db', 'calibr.db');
try { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); } catch (e) {}
const db = new DatabaseSync(DB_PATH);
try { db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;'); } catch (e) {}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,                 -- seeker | employer | partner | admin
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass TEXT NOT NULL,
  dob TEXT,
  consent_at TEXT,
  company_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER,
  culture TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,                 -- aptitude | technical | personality | culture | integrity | cognitive
  status TEXT NOT NULL DEFAULT 'not_started',
  score INTEGER,
  taken_at TEXT
);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  composite INTEGER NOT NULL,
  axes TEXT NOT NULL,                 -- JSON of per-axis values
  token TEXT NOT NULL,                -- public verify token
  issued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roles_posted (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  spec TEXT,
  weights TEXT,                      -- JSON per-axis weights (sum 100)
  salary INTEGER,                    -- expected annual salary (ZAR)
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  stage TEXT NOT NULL DEFAULT 'New', -- New | Shortlist | Interview | Offer | Hired | Rejected
  fit INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(role_id, user_id)
);
CREATE TABLE IF NOT EXISTS saved_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, role_id)
);
CREATE TABLE IF NOT EXISTS cover_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role_title TEXT,
  company TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT,
  qa TEXT,                            -- JSON [{q, a, feedback, score}]
  score INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scorecards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL,
  criteria TEXT NOT NULL,             -- JSON [{name,weight}]
  created_at TEXT NOT NULL,
  UNIQUE(role_id)
);
CREATE TABLE IF NOT EXISTS scorecard_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  reviewer TEXT,
  ratings TEXT,                       -- JSON {criterion: 1..5}
  overall INTEGER,                    -- weighted 0..100
  recommendation TEXT,                -- strong_yes|yes|no|strong_no
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interview_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  when_at TEXT,
  mode TEXT,                          -- video | in-person | phone
  location TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wellness_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mood INTEGER,                       -- 1..5
  stress INTEGER,                     -- 1..5
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  company_id INTEGER,
  kind TEXT NOT NULL,                 -- subscription | success_fee
  plan TEXT,
  amount INTEGER,                     -- ZAR (whole rand)
  reference TEXT,                     -- Paystack reference
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  platform TEXT NOT NULL,             -- linkedin | indeed | pnet | careers24 | jobmail
  status TEXT NOT NULL DEFAULT 'connected',
  account_label TEXT,                 -- the employer's account name/email on that platform
  secret TEXT,                        -- their token/key (never rendered back to the browser)
  created_at TEXT NOT NULL,
  UNIQUE(company_id, platform)
);
CREATE TABLE IF NOT EXISTS fee_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL,
  salary INTEGER,
  pct REAL,
  amount INTEGER,
  status TEXT NOT NULL DEFAULT 'owing',
  created_at TEXT NOT NULL
);
`);

// Additive columns for existing installs (idempotent)
for (const stmt of [
  "ALTER TABLE users ADD COLUMN cv TEXT",
  "ALTER TABLE users ADD COLUMN ee_race TEXT",
  "ALTER TABLE users ADD COLUMN ee_gender TEXT",
  "ALTER TABLE roles_posted ADD COLUMN weights TEXT",
  "ALTER TABLE roles_posted ADD COLUMN salary INTEGER",
  "ALTER TABLE assessments ADD COLUMN raw TEXT",
  // --- job posting / distribution ---
  "ALTER TABLE roles_posted ADD COLUMN description TEXT",     // full JD text
  "ALTER TABLE roles_posted ADD COLUMN location TEXT",
  "ALTER TABLE roles_posted ADD COLUMN emp_type TEXT",        // Full-time | Part-time | Contract | Learnership
  "ALTER TABLE roles_posted ADD COLUMN salary_min INTEGER",
  "ALTER TABLE roles_posted ADD COLUMN salary_max INTEGER",
  "ALTER TABLE roles_posted ADD COLUMN keywords TEXT",        // JSON [{term,weight,must}]
  "ALTER TABLE roles_posted ADD COLUMN requirements TEXT",    // JSON summary from JD parse
  "ALTER TABLE roles_posted ADD COLUMN public_token TEXT",    // public apply link
  "ALTER TABLE roles_posted ADD COLUMN is_public INTEGER DEFAULT 1",
  "ALTER TABLE roles_posted ADD COLUMN distributed TEXT",     // JSON {platform:status}
  // --- application: JD-aware ingest + external applicants ---
  "ALTER TABLE applications ADD COLUMN jd_match INTEGER",      // 0-100 CV↔JD match
  "ALTER TABLE applications ADD COLUMN jd_report TEXT",        // JSON {matched,missing,flags,summary}
  "ALTER TABLE applications ADD COLUMN cv_text TEXT",          // CV as applied
  "ALTER TABLE applications ADD COLUMN source TEXT",           // pool | public | bulk
  "ALTER TABLE applications ADD COLUMN hired_at TEXT",         // set when stage -> Hired (time-to-hire)
  // --- billing ---
  "ALTER TABLE users ADD COLUMN plan TEXT",                    // seeker/employer subscription plan
  "ALTER TABLE users ADD COLUMN plan_since TEXT",
  "ALTER TABLE companies ADD COLUMN plan TEXT",
  "ALTER TABLE companies ADD COLUMN culture_w TEXT",          // per-dimension culture weights (JSON)
  // --- partner programme ---
  "ALTER TABLE users ADD COLUMN referral_code TEXT",           // partner's referral code
  "ALTER TABLE companies ADD COLUMN referred_by INTEGER",      // partner user id who referred this company
  "ALTER TABLE payments ADD COLUMN paid_out INTEGER DEFAULT 0",// partner commission settled
]) { try { db.exec(stmt); } catch (e) { /* column exists */ } }

// Persistent session store table (replaces in-memory MemoryStore for production).
db.exec(`CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL)`);

module.exports = {
  raw: db,
  get(sql, ...p) { return db.prepare(sql).get(...p); },
  all(sql, ...p) { return db.prepare(sql).all(...p); },
  run(sql, ...p) { return db.prepare(sql).run(...p); },
};
