# CALIBR App — working build (KTH-Tech)

The real, running CALIBR platform (early build). Node + Express + built-in SQLite. No cloud needed to run locally.

## Run it
```bash
cd "CALIBR/app"
npm install        # first time only
npm start          # then open http://localhost:4000
```
Port 4000 by default. If it's taken: `PORT=4100 npm start`.

## What works right now (built & tested end-to-end)
- **Accounts & auth** — signup / login / logout, passwords hashed (bcrypt), sessions, POPIA consent captured at signup, role selected (job seeker / employer).
- **Mobile-first UI** — responsive throughout (fluid type, stacking layouts, 44px touch targets, horizontally-scrolling tables). Brand-consistent (black / white / hot-pink #FF1F70, Inter, bullseye mark).
- **Job-seeker app** (`/app`) — dashboard, take the **six assessments** (Aptitude, Technical, Cognitive, Personality, Culture-Fit, Integrity) each graded 0–100, plus an optional **profile** (POPIA-protected EE self-ID + CV paste).
- **CALIBR Score** — generated from the six assessments (per-axis + composite), **server-issued with a tamper-proof public token**.
- **Public verification** (`/verify/:token`) — anyone can verify a candidate's score; server-issued, not user-editable.
- **Employer app** (`/company`) — dashboard, **post a role** (title + salary + per-axis rubric weights), **screen the pre-scored pool** (`/company/role/:id`) ranked by weighted **fit**, re-weight the rubric to re-rank, **add to pipeline**, move candidates through stages (New → Shortlist → Interview → Offer → Hired / Rejected). Marking **Hired auto-creates a 2% success-fee event**.
- **Culture profile** (`/company/culture`) — the employer answers the culture questions as their *ideal*; **Culture-Fit is then scored company-relative** (how closely each candidate matches you), feeding the weighted fit per role.
- **Reports** (`/company/reports`) — Employment-Equity breakdown of hires (by self-ID) + CALIBR success-fee summary (owing).
- **ATS Optimizer** (`/app/cv`) — paste your CV **and the actual job ad** (+ pick the target ATS: Workday / Greenhouse / SAP SuccessFactors / Taleo / Generic). CALIBR returns a **match %**, **matched vs missing keywords** (★ = must-have gaps), **parse-safety flags**, and — with an API key — a **truthful, JD-tuned rewrite** with a **re-scored** match. Match scoring, keyword gaps and parse-safety work **with no API key** (deterministic engine, `ats.js`); the key only adds the AI rewrite and a nuanced second-opinion score.
- **Job posting + distribution** (employer `/company/post` → `/company/role/:id/distribute`) — write the JD once; CALIBR extracts the ATS keywords, gives a **public apply page** (`/jobs/:token`) with **schema.org JobPosting** structured data (auto-indexed by **Google for Jobs**) and publishes an **Indeed-compatible XML feed** (`/jobs.xml`). These three channels are always on, no account needed.
- **Per-company platform connections** (`/company/connections`) — each employer connects the boards **they** use (LinkedIn, Indeed, Pnet, Careers24, Job Mail) with their own account credential. A connected platform shows **"Auto · via your account"** on the distribute page and posts through **their** account (not a CALIBR-owned one); unconnected platforms show a **Connect** button + a share link. Credentials are stored per company in the `connections` table and never rendered back to the browser. (Real posting runs on each platform's partner API, which requires a paid recruiter account there.)
- **JD-aware apply ingestion** (`/jobs/:token/apply`, public) — an applicant pastes their CV; it is **parsed and scored against that specific job** on submit, creating a pipeline application with a **JD match %**, matched/missing keywords and parse flags. If they already have a CALIBR Score it's blended in and travels with the application. Employers see it all on the applicant detail page (`/company/app/:id`).
- **AI Mock Interview** (`/app/interview`) — role/JD-specific question set → answer each → per-answer feedback + 0–100 score, saved to history. Deterministic STAR/specificity scoring with no key; full AI feedback with a key.
- **Cover Letters** (`/app/cover-letters`) — CV + job ad → tailored letter, saved to history. Structured template with no key; fully-written letter with a key.
- **Growth Path** (`/app/growth`) — a prioritised roadmap built from the two weakest CALIBR Score axes (+ optional target role) with concrete SA-relevant steps and quick wins; AI-enriched when a key is present.
- **My Applications + Saved Jobs** (`/app/applications`) — the seeker's applications with JD match % + stage, and saved roles. "Save job" on any public posting. Dashboard shows recent applications + recommended jobs.
- **Score history + printable card** (`/app/score`) — full versioned Score history table + an A4 **print/Save-as-PDF Score card** (`/app/score/card/:token`).
- **Assessment anti-cheat** — questions presented in shuffled order (grading unaffected), a countdown timer that auto-submits, and tab-switch detection recorded with the result.
- **Wellness** (`/app/wellness`) — non-clinical self-check with a prominent disclaimer + SA crisis lines (SADAG, Lifeline), mood/stress check-ins with history, and job-search wellbeing tips.
- **Bulk CV upload** (employer `/company/role/:id/bulk`) — paste many CVs (separated by `---`); each is JD-scored, a candidate record is found/created, all are added to the pipeline ranked by JD match.
- **Billing — Paystack** (`/app/billing` seeker plans R199/R349/R499; `/company/billing` 2% success-fee settlement) — real `transaction/initialize` + verify + **signed webhook** (`/paystack/webhook`, HMAC-SHA512 validated). Inert until `PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY` are in `.env`; then checkout + settlement go live and a paid subscription sets the user's plan.
- **Partner portal** (`/partner`) — partner role (sign up as Partner) gets a **referral link/code**; employers who sign up via `?ref=CODE` are attributed to them; dashboard tracks referred companies, hires, and **30%-of-success-fee commission** (earned + pending), with referrals, co-branded materials and payouts pages.
- **Admin console** (`/admin`) — platform stats by role, success-fee revenue (settled/owing), recent payments, and **Users / Companies / Partners / Payments** lists. Admins are bootstrapped via `ADMIN_EMAILS` in `.env` (auto-promoted on signup/login).
- **Production hardening** — sessions moved to a **persistent SQLite store** (`store.js`, survives restarts, auto-reaps expired); `httpOnly` + `sameSite=lax` cookies, and `secure` cookies + `trust proxy` when `NODE_ENV=production`.

## Enable AI (CV Optimizer, and future tools)
Copy `.env.example` to `.env` and add ONE key:
```
ANTHROPIC_API_KEY=sk-ant-...        # recommended
# or OPENAI_API_KEY=sk-...
```
Restart the app. Without a key the AI features show a clear "not configured" message (nothing breaks). Never commit `.env`.

Reset the data anytime by deleting `app/db/calibr.db` (it re-creates on next start).

## Data
SQLite file at `app/db/calibr.db` (auto-created). Tables: users, companies, assessments, scores, roles_posted.

## Still to build (per the full-platform spec, `../CALIBR-Product-Spec-LoggedIn.md`)
- Employer: real **file** upload for bulk CVs (currently paste-based, no multipart dep), structured interview kits, team seats.
- Job seeker: external **aggregated job feed** (currently the board = CALIBR-posted roles).
- Polish: first-run **onboarding wizard**, **email/notifications**, partner banking-details onboarding + automated payouts.
- **Go live (not code — ops):** add Paystack keys (billing) + each platform's OAuth/API creds (auto-posting) — both wired, inert until keys land; cloud **deploy with SA data residency** (`NODE_ENV=production`, set `SESSION_SECRET`/`ADMIN_EMAILS`; also the unlock for Google-for-Jobs indexing + OAuth redirect URLs); TLS, rate-limiting, backups; **assessment bias-testing/validation by an I-O specialist** before the Score drives real decisions.
- Academy (Learn) — separate track, Q1 2027.

## Notes
- Assessment content here is a starter bank for the working loop — before any hiring decision relies on the Score, the assessments need proper validation & bias testing by an I/O specialist (flagged in the spec).
- Session store is in-memory (dev). Add a persistent store + HTTPS for production.
