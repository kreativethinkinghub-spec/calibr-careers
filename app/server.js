'use strict';
try { process.loadEnvFile(require('path').join(__dirname, '.env')); } catch (e) { /* no .env yet */ }
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { shell, esc } = require('./views');
const { BANK, grade } = require('./assessments');
const llm = require('./llm');
const ats = require('./ats');
const distribute = require('./distribute');
const oauth = require('./oauth');
const coach = require('./coach');
const paystack = require('./paystack');
const notify = require('./notify');

const SqliteStore = require('./store');
let hiring = null; // employer hiring toolkit (scorecards, scheduling, analytics) — registered before listen
let collab = null; // careers page + candidate comments — registered before listen
let webhooks = null; // public API + outbound webhooks — registered before listen

const app = express();
const PROD = process.env.NODE_ENV === 'production';
if (PROD) {
  app.set('trust proxy', 1); // behind a TLS-terminating proxy (Render/Cloudflare/nginx)
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me') console.warn('WARNING: set a strong SESSION_SECRET in production.');
}
app.use(express.urlencoded({ extended: true }));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use(session({
  store: new SqliteStore(),
  secret: 'calibr-' + (process.env.SESSION_SECRET || 'dev-change-me'),
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8, httpOnly: true, sameSite: 'lax', secure: PROD },
}));

const now = () => new Date().toISOString();
const TYPES = Object.keys(BANK);
const AXES = ['Skills / Technical', 'Aptitude / Cognitive', 'Personality', 'Culture-Fit', 'Integrity'];
const STAGES = ['New', 'Shortlist', 'Interview', 'Offer', 'Hired', 'Rejected'];
const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean));
function isAdminEmail(email) { return ADMIN_EMAILS.has((email || '').toLowerCase()); }
function homeFor(role) { return role === 'employer' ? '/company' : role === 'partner' ? '/partner' : role === 'admin' ? '/admin' : '/app'; }
function fitFor(axesJson, weightsJson) {
  const ax = JSON.parse(axesJson || '{}'); const w = weightsJson ? JSON.parse(weightsJson) : null;
  let tot = 0, ws = 0;
  AXES.forEach(k => { const wt = w && w[k] != null ? Number(w[k]) : 20; tot += (ax[k] || 0) * wt; ws += wt; });
  return ws ? Math.round(tot / ws) : 0;
}
// Company-relative Culture-Fit: how closely a candidate's answers match the company's ideal profile.
// Company-relative Culture-Fit across the 7 named dimensions, weighted per employer.
// Returns { score, dims:[{label, ideal, cand, fit, weight, note}] } — the "why this fit" breakdown.
function cultureBreakdown(rawJson, profileArr, weightArr) {
  if (!rawJson || !profileArr || !profileArr.length) return null;
  let raw; try { raw = JSON.parse(rawJson); } catch (e) { return null; }
  const dims = BANK.culture.q;
  let wsum = 0, acc = 0; const rows = [];
  for (let i = 0; i < profileArr.length; i++) {
    const c = raw['q' + i], p = profileArr[i];
    if (c == null || p == null || Number.isNaN(c)) continue;
    const w = weightArr && weightArr[i] != null ? Number(weightArr[i]) : 1;
    const fit = Math.round(100 * (1 - Math.abs(c - p) / 3));
    if (w > 0) { wsum += w; acc += fit * w; }
    const q = dims[i] || {};
    const dir = c === p ? '' : (c > p ? 'more' : 'less');
    const note = w === 0 ? 'Not weighted' : fit >= 80 ? 'Strong match' : fit >= 50 ? 'Partial fit' : ('Diverges — candidate leans ' + dir);
    rows.push({ label: q.label || ('Dimension ' + (i + 1)), ideal: q.o ? q.o[p] : p, cand: q.o ? q.o[c] : c, fit, weight: w, note });
  }
  return { score: wsum > 0 ? Math.round(acc / wsum) : null, dims: rows };
}
function cultureFitVs(rawJson, profileArr, weightArr) { const b = cultureBreakdown(rawJson, profileArr, weightArr); return b ? b.score : null; }
function companyProfile(companyId) { const co = db.get('SELECT culture FROM companies WHERE id=?', companyId); try { return JSON.parse(co && co.culture); } catch (e) { return null; } }
function cultureWeightsOf(companyId) { const co = db.get('SELECT culture_w FROM companies WHERE id=?', companyId); try { return JSON.parse(co && co.culture_w); } catch (e) { return null; } }
function cultureRawMap() { return Object.fromEntries(db.all("SELECT user_id, raw FROM assessments WHERE type='culture' AND status='done'").map(a => [a.user_id, a.raw])); }
function axesWithCulture(axesJson, uid, profile, rawMap, weights) {
  const ax = JSON.parse(axesJson);
  if (profile && rawMap[uid]) { const cf = cultureFitVs(rawMap[uid], profile, weights); if (cf != null) ax['Culture-Fit'] = cf; }
  return ax;
}

const absUrl = (req, p) => `${req.protocol}://${req.get('host')}${p}`;
function ensureToken(role) {
  if (role.public_token) return role.public_token;
  const t = crypto.randomBytes(5).toString('hex');
  db.run('UPDATE roles_posted SET public_token=? WHERE id=?', t, role.id);
  role.public_token = t; return t;
}
// Recompute + store a role's JD keywords from its description (LLM if key present, else deterministic).
async function reindexRole(role) {
  if (!role.description) return;
  const parsed = await ats.parseJD(role.description);
  db.run('UPDATE roles_posted SET keywords=?, requirements=? WHERE id=?',
    JSON.stringify(parsed.keywords), JSON.stringify({ must_have: parsed.must_have, nice_to_have: parsed.nice_to_have, seniority: parsed.seniority, summary: parsed.summary, source: parsed.source }), role.id);
  role.keywords = JSON.stringify(parsed.keywords);
  return parsed;
}
function roleKeywords(role) { try { return JSON.parse(role.keywords || '[]'); } catch (e) { return []; } }
// This company's connected job-platform accounts as { platform: {status, account_label} } (no secrets).
function companyConnections(companyId) {
  const rows = db.all('SELECT platform, status, account_label FROM connections WHERE company_id=?', companyId || 0);
  return Object.fromEntries(rows.map(r => [r.platform, r]));
}

function user(req) { return req.session.uid ? db.get('SELECT * FROM users WHERE id=?', req.session.uid) : null; }
function requireAuth(req, res, next) { const u = user(req); if (!u) return res.redirect('/login'); req.user = u; next(); }
function requireRole(role) { return (req, res, next) => { if (req.user.role !== role) return res.status(403).send('Forbidden'); next(); }; }

// ---------- HOME ----------
let LANDING = null; try { LANDING = fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8'); } catch (e) { /* no landing file */ }
app.get('/', (req, res) => {
  const u = user(req);
  if (u) return res.redirect(homeFor(u.role));
  if (LANDING) return res.send(LANDING); // the marketing landing IS the app's front door
  res.send(shell({ title: 'Welcome', body: `
    <div style="text-align:center;padding:60px 0">
      <h1>Score every candidate.<br><em>Land every role.</em></h1>
      <p class="sub">The CALIBR platform. Build your verified Score, or hire on evidence.</p>
      <a class="btn" href="/signup">Get started</a> &nbsp; <a class="btn g" href="/login">Sign in</a>
      <p style="margin-top:24px;font-size:13px;color:var(--grey)">This is the working app (early build). <a href="https://calibr-careers.tech" style="color:var(--pink);font-weight:700">See the marketing site</a></p>
    </div>` }));
});

// ---------- AUTH ----------
app.get('/signup', (req, res) => res.send(shell({ title: 'Sign up', body: `
  <div class="auth"><h2>Create your account</h2>
  ${req.query.e ? `<div class="err">${esc(req.query.e)}</div>` : ''}
  <form method="post" action="/signup">
    <div class="fld"><label>I am a…</label><select name="role" required>
      <option value="seeker"${req.query.role === 'seeker' ? ' selected' : ''}>Job seeker (build my Score)</option>
      <option value="employer"${req.query.role === 'employer' ? ' selected' : ''}>Employer (hire on evidence)</option>
      <option value="partner"${req.query.role === 'partner' ? ' selected' : ''}>Partner (refer &amp; resell)</option>
    </select></div>
    ${req.query.ref ? `<input type="hidden" name="ref" value="${esc(req.query.ref)}"><div class="msg">Referred by a CALIBR partner — welcome.</div>` : ''}
    <div class="fld"><label>Full name</label><input name="name" required></div>
    <div class="fld"><label>Email</label><input type="email" name="email" required></div>
    <div class="fld"><label>Company (employers &amp; partners)</label><input name="company" placeholder="Optional for job seekers"></div>
    <div class="fld"><label>Date of birth</label><input type="date" name="dob"></div>
    <div class="fld"><label>Password</label><input type="password" name="pass" minlength="6" required></div>
    <div class="fld" style="font-size:12px;color:var(--grey)"><label style="text-transform:none;letter-spacing:0;font-weight:500"><input type="checkbox" name="consent" required style="width:auto;margin-right:8px">I consent to CALIBR processing my personal information per the POPIA-aligned privacy policy.</label></div>
    <button class="btn" style="width:100%">Create account</button>
  </form>
  <p style="margin-top:16px;font-size:13px;color:var(--grey)">Already have an account? <a href="/login" style="color:var(--pink);font-weight:700">Sign in</a></p>
  </div>` })));

app.post('/signup', (req, res) => {
  let { role, name, email, company, dob, pass, consent } = req.body;
  email = (email || '').toLowerCase();
  if (!consent) return res.redirect('/signup?e=' + encodeURIComponent('You must accept the privacy terms.'));
  if (!['seeker', 'employer', 'partner'].includes(role)) return res.redirect('/signup?e=Invalid+role');
  if (isAdminEmail(email)) role = 'admin';
  const exists = db.get('SELECT id FROM users WHERE email=?', email);
  if (exists) return res.redirect('/signup?e=' + encodeURIComponent('That email is already registered.'));
  const hash = bcrypt.hashSync(pass, 10);
  let companyId = null;
  if (role === 'employer') {
    const c = db.run('INSERT INTO companies (name, culture, created_at) VALUES (?,?,?)', company || (name + "'s company"), 'balanced', now());
    companyId = Number(c.lastInsertRowid);
  }
  const refCode = role === 'partner' ? 'P' + crypto.randomBytes(4).toString('hex').toUpperCase() : null;
  const u = db.run('INSERT INTO users (role,name,email,pass,dob,consent_at,company_id,referral_code,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    role, name, email, hash, dob || null, now(), companyId, refCode, now());
  const uid = Number(u.lastInsertRowid);
  if (companyId) {
    db.run('UPDATE companies SET owner_id=? WHERE id=?', uid, companyId);
    // attribute the company to a referring partner if a valid ref code was supplied
    if (req.body.ref) { const p = db.get("SELECT id FROM users WHERE referral_code=? AND role='partner'", String(req.body.ref).toUpperCase()); if (p) db.run('UPDATE companies SET referred_by=? WHERE id=?', p.id, companyId); }
  }
  req.session.uid = uid;
  res.redirect(role === 'employer' ? '/company/setup' : role === 'partner' ? '/partner' : role === 'admin' ? '/admin' : '/app/setup');
});

app.get('/login', (req, res) => res.send(shell({ title: 'Sign in', body: `
  <div class="auth"><h2>Sign in</h2>
  ${req.query.e ? `<div class="err">${esc(req.query.e)}</div>` : ''}
  <form method="post" action="/login">
    <div class="fld"><label>Email</label><input type="email" name="email" required></div>
    <div class="fld"><label>Password</label><input type="password" name="pass" required></div>
    <button class="btn" style="width:100%">Sign in</button>
  </form>
  <p style="margin-top:16px;font-size:13px;color:var(--grey)">New here? <a href="/signup" style="color:var(--pink);font-weight:700">Create an account</a></p>
  </div>` })));

app.post('/login', (req, res) => {
  const u = db.get('SELECT * FROM users WHERE email=?', (req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.pass || '', u.pass)) return res.redirect('/login?e=' + encodeURIComponent('Wrong email or password.'));
  if (u.role !== 'admin' && isAdminEmail(u.email)) { db.run('UPDATE users SET role=? WHERE id=?', 'admin', u.id); u.role = 'admin'; }
  req.session.uid = u.id;
  res.redirect(homeFor(u.role));
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// ---------- JOB SEEKER ----------
app.get('/app', requireAuth, requireRole('seeker'), (req, res) => {
  const rows = db.all('SELECT type,status,score FROM assessments WHERE user_id=?', req.user.id);
  const byType = Object.fromEntries(rows.map(r => [r.type, r]));
  const doneCount = TYPES.filter(t => byType[t] && byType[t].status === 'done').length;
  const score = db.get('SELECT * FROM scores WHERE user_id=? ORDER BY id DESC LIMIT 1', req.user.id);
  const cards = TYPES.map(t => {
    const r = byType[t]; const done = r && r.status === 'done';
    return `<div class="card"><span class="pill ${done ? 'done' : 'todo'}">${done ? 'Done · ' + r.score : 'Not started'}</span>
      <h3 style="margin-top:12px">${BANK[t].label}</h3><p>${BANK[t].blurb}</p>
      <a class="btn sm ${done ? 'g' : ''}" href="/app/assess/${t}">${done ? 'Retake' : 'Take test'}</a></div>`;
  }).join('');
  let scoreBlock;
  if (score) {
    const axes = JSON.parse(score.axes);
    scoreBlock = `<div class="score-hero"><div><div class="score-num">${score.composite}</div><div class="badge-verified">✔ Verified CALIBR Score</div></div>
      <div style="flex:1">${Object.entries(axes).map(([k, v]) => `<div class="axis"><span>${esc(k)}</span><b>${v}</b></div><div class="bar"><i style="width:${v}%"></i></div>`).join('')}</div></div>
      <p class="sub">Share your verified score: <a href="/verify/${score.token}" style="color:var(--pink);font-weight:700">/verify/${score.token}</a> · issued ${esc(score.issued_at.slice(0,10))}</p>`;
  } else {
    scoreBlock = `<div class="msg">Complete all six assessments to generate your verified CALIBR Score. <b>${doneCount}/6 done.</b></div>
      ${doneCount === 6 ? `<form method="post" action="/app/score"><button class="btn">Generate my CALIBR Score</button></form>` : ''}`;
  }
  res.send(shell({ title: 'Dashboard', user: req.user, body: `
    <h1>Hi ${esc(req.user.name.split(' ')[0])}<em>.</em></h1><p class="sub">Build your verified CALIBR Score, then share it with any employer.</p>
    ${scoreBlock}
    ${score ? `<form method="post" action="/app/score" style="margin-top:8px"><button class="btn g sm">Re-generate Score</button></form>` : ''}
    <div class="lbl">Grow tools</div>
    <div class="actions">
      <a class="btn sm" href="/app/cv">ATS Optimizer</a>
      <a class="btn sm" href="/app/interview">Mock Interview</a>
      <a class="btn sm" href="/app/cover-letters">Cover Letters</a>
      <a class="btn sm" href="/app/growth">Growth Path</a>
      <a class="btn sm" href="/app/applications">My Applications</a>
      <a class="btn sm" href="/app/wellness">Wellness</a>
      <a class="btn sm" href="/app/billing">Billing</a>
      <a class="btn sm g" href="/app/setup">Setup guide</a>
      <a class="btn sm g" href="/jobs">Browse jobs</a>
    </div>
    ${(() => {
      const myApps = db.all('SELECT a.*, r.title, c.name company, r.public_token FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN companies c ON c.id=r.company_id WHERE a.user_id=? ORDER BY a.id DESC LIMIT 4', req.user.id);
      const recs = db.all(`SELECT r.*, c.name company FROM roles_posted r JOIN companies c ON c.id=r.company_id WHERE r.is_public=1 AND r.public_token IS NOT NULL AND r.status='open' AND r.id NOT IN (SELECT role_id FROM applications WHERE user_id=?) ORDER BY r.id DESC LIMIT 3`, req.user.id);
      let h = '';
      if (myApps.length) h += `<div class="lbl">Your applications</div><div class="table-wrap"><table><tr><th>Role</th><th>Company</th><th>JD match</th><th>Stage</th></tr>${myApps.map(a => `<tr><td><b>${esc(a.title)}</b></td><td>${esc(a.company)}</td><td>${a.jd_match != null ? a.jd_match + '%' : '—'}</td><td><span class="pill ${a.stage === 'Hired' ? 'done' : 'todo'}">${esc(a.stage)}</span></td></tr>`).join('')}</table></div>`;
      if (recs.length) h += `<div class="lbl">Recommended jobs</div><div class="grid">${recs.map(r => `<div class="card"><h3 style="margin:0">${esc(r.title)}</h3><p>${esc(r.company)}${r.location ? ' · ' + esc(r.location) : ''}</p><a class="btn sm" href="/jobs/${r.public_token}">View &amp; apply</a></div>`).join('')}</div>`;
      return h;
    })()}
    <div class="lbl">Profile · optional, POPIA-protected</div>
    <form method="post" action="/app/profile">
      <div class="fld inline">
        <div><label>Race (EE self-ID)</label><select name="ee_race"><option value="">Prefer not to say</option>${['African','Coloured','Indian','White','Other'].map(o => `<option${req.user.ee_race === o ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
        <div><label>Gender (EE self-ID)</label><select name="ee_gender"><option value="">Prefer not to say</option>${['Female','Male','Other'].map(o => `<option${req.user.ee_gender === o ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
      </div>
      <div class="fld"><label>Your CV (paste text)</label><textarea name="cv" placeholder="Paste your CV so employers see it with your Score">${esc(req.user.cv || '')}</textarea></div>
      <button class="btn sm">Save profile</button>
    </form>
    <div class="lbl">Your assessments</div><div class="grid">${cards}</div>` }));
});

// ---------- METHODOLOGY & EVIDENCE (public) ----------
app.get('/methodology', (req, res) => {
  res.send(shell({ title: 'Methodology & Evidence', user: user(req), body: `
    <h1>Methodology &amp; Evidence<em>.</em></h1>
    <p class="sub">Why the CALIBR Score is built the way it is — and the research it stands on. Written plainly, with honest limits.</p>

    <div class="lbl">The principle</div>
    <p>Decades of selection-science research converge on a clear finding: <b>structured, standardized, job-relevant assessment predicts on-the-job performance far better than unstructured interviews or CV screening</b> — and does so more fairly, because every candidate is measured on the same evidence. CALIBR is built around that finding.</p>

    <div class="lbl">What each axis is grounded in</div>
    <div class="table-wrap"><table><tr><th>CALIBR axis</th><th>Research basis</th></tr>
      <tr><td><b>Aptitude / Cognitive</b></td><td>General cognitive ability is among the strongest, most consistent predictors of job performance across roles and industries (Schmidt &amp; Hunter meta-analysis of 85 years of selection research, 1998).</td></tr>
      <tr><td><b>Skills / Technical</b></td><td>Sampling job-relevant ability (the "work-sample" logic) is one of the highest-validity selection methods — you measure the thing the job actually needs.</td></tr>
      <tr><td><b>Integrity</b></td><td>Integrity tests add <em>incremental</em> validity over cognitive ability and predict counterproductive work behaviour (Ones, Viswesvaran &amp; Schmidt meta-analyses).</td></tr>
      <tr><td><b>Personality</b></td><td>Conscientiousness and related traits show consistent, if modest, links to performance (Barrick &amp; Mount).</td></tr>
      <tr><td><b>Culture-Fit</b></td><td>Person–Organization fit — the congruence between a person's values and a <em>specific</em> organization's — relates to job satisfaction, commitment and retention (Kristof-Brown, Zimmerman &amp; Johnson meta-analysis, 2005). This is why CALIBR measures culture-fit <b>against your company's own profile, weighted by what you value</b> — not as a generic "culture score."</td></tr>
    </table></div>

    <div class="lbl">How we keep it fair</div>
    <ul class="flags">
      <li><b>Structure &amp; standardization</b> — identical items and scoring for every candidate reduce interviewer bias.</li>
      <li><b>Company-relative culture-fit</b> — you define the target and its weights, and the score <em>shows its working</em> per dimension, so "fit" can't hide as a euphemism.</li>
      <li><b>SA law</b> — the Employment Equity Act (s8) requires that any assessment used for selection be <b>scientifically valid, reliable and applied fairly</b>; POPIA governs the candidate data. Our build plan includes reliability estimation, a predictive-validity study, and adverse-impact (four-fifths rule) analysis by an Industrial-Organisational specialist before the Score is used to <em>gate</em> a hire.</li>
    </ul>

    <div class="callout" style="background:var(--paper2);border-left:3px solid var(--pink);padding:12px 14px">
      <b>Honest limits.</b> The published validity figures above describe the <em>methods</em> CALIBR uses — not CALIBR's specific question banks, which are a working starter set and require local validation. Until that validation is complete, use the CALIBR Score as <b>decision-support alongside human judgement</b>, not as an automatic gate. We would rather say this clearly than overclaim.
    </div>

    <div class="lbl">Sources</div>
    <p class="sub" style="font-size:12px;line-height:1.7">
      Schmidt, F. &amp; Hunter, J. (1998), <em>The validity and utility of selection methods in personnel psychology</em>, Psychological Bulletin. ·
      Kristof-Brown, A., Zimmerman, R. &amp; Johnson, E. (2005), <em>Consequences of individuals' fit at work</em> (P-O fit meta-analysis), Personnel Psychology. ·
      Ones, D., Viswesvaran, C. &amp; Schmidt, F., integrity-test meta-analyses. ·
      Barrick, M. &amp; Mount, M. (1991), the Big Five and job performance. ·
      SIOP <em>Principles for the Validation and Use of Personnel Selection Procedures</em>; APA/AERA <em>Standards</em>. ·
      Republic of South Africa, <em>Employment Equity Act 55 of 1998</em>, s8; <em>POPIA</em>.
    </p>
    <a class="btn g" href="/">Back</a>` }));
});

// ---------- GUIDED SETUP / ONBOARDING ----------
function setupPage(title, subtitle, steps, homeHref) {
  const done = steps.filter(s => s.done).length, pct = Math.round(done / steps.length * 100);
  const rows = steps.map((s, i) => `<div class="q" style="display:flex;gap:14px;align-items:flex-start">
    <div style="flex:none;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;${s.done ? 'background:var(--pink);color:#fff' : 'border:2px solid var(--ink);color:var(--ink)'}">${s.done ? '✓' : (i + 1)}</div>
    <div style="flex:1">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <b style="font-size:15px">${esc(s.title)}</b>
        ${s.status ? `<span class="pill ${s.done ? 'done' : 'todo'}">${esc(s.status)}</span>` : ''}
      </div>
      <p style="font-size:13px;color:var(--dim);margin:4px 0 10px">${s.desc}</p>
      ${s.href ? `<a class="btn sm ${s.done ? 'g' : ''}" href="${s.href}">${esc(s.cta || (s.done ? 'Review' : 'Start'))}</a>` : ''}
    </div></div>`).join('');
  return `<h1>${esc(title)}<em>.</em></h1><p class="sub">${subtitle}</p>
    <div class="lbl">Setup progress · ${done}/${steps.length}</div>
    <div class="track" style="height:10px"><i style="width:${pct}%"></i></div>
    <div style="margin-top:18px">${rows}</div>
    ${done === steps.length ? `<div class="msg" style="margin-top:14px">You’re all set. <a href="${homeHref}" style="color:var(--pink);font-weight:700">Go to your dashboard &rarr;</a></div>` : `<a class="btn g" href="${homeHref}" style="margin-top:14px">Skip to dashboard</a>`}`;
}

app.get('/company/setup', requireAuth, requireRole('employer'), (req, res) => {
  const co = db.get('SELECT * FROM companies WHERE id=?', req.user.company_id) || { name: 'Your company' };
  const cultureSet = !!companyProfile(req.user.company_id);
  const roles = db.get('SELECT COUNT(*) n FROM roles_posted WHERE company_id=?', req.user.company_id || 0).n;
  const conns = companyConnections(req.user.company_id); const nConn = distribute.PARTNERS.filter(p => conns[p.key] && conns[p.key].status === 'connected').length;
  const steps = [
    { done: true, title: 'Company account created', desc: `Signed in as <b>${esc(co.name)}</b>.`, href: '/company', cta: 'Open dashboard', status: 'Done' },
    { done: cultureSet, title: 'Define your culture profile', desc: 'Set your ideal across the 7 dimensions and how much each matters — so Culture-Fit scores every candidate against <b>you</b>.', href: '/company/culture', cta: cultureSet ? 'Edit profile' : 'Set it up', status: cultureSet ? 'Set' : 'Not set' },
    { done: roles > 0, title: 'Post your first role', desc: 'Write the job once — CALIBR extracts the keywords, screens the scored pool, and gives you a public apply page.', href: '/company/post', cta: roles > 0 ? 'Post another' : 'Post a job', status: roles > 0 ? roles + ' posted' : 'None yet' },
    { done: nConn > 0, title: 'Connect your job boards (optional)', desc: 'Post to LinkedIn / Indeed / Pnet through your own account. CALIBR’s board + Google for Jobs are always on.', href: '/company/connections', cta: nConn > 0 ? 'Manage' : 'Connect', status: nConn > 0 ? nConn + ' connected' : 'Optional' },
  ];
  res.send(shell({ title: 'Setup', user: req.user, body: setupPage('Welcome to CALIBR', 'A few steps to calibrate hiring for your team. You can do these in any order.', steps, '/company') }));
});

app.get('/app/setup', requireAuth, requireRole('seeker'), (req, res) => {
  const doneN = db.get("SELECT COUNT(DISTINCT type) n FROM assessments WHERE user_id=? AND status='done'", req.user.id).n;
  const hasScore = !!db.get('SELECT id FROM scores WHERE user_id=? LIMIT 1', req.user.id);
  const profileDone = !!(req.user.cv && req.user.cv.length > 40);
  const steps = [
    { done: true, title: 'Account created', desc: `Welcome, ${esc((req.user.name || '').split(' ')[0])}.`, href: '/app', cta: 'Open dashboard', status: 'Done' },
    { done: profileDone, title: 'Add your profile & CV', desc: 'Paste your CV and (optionally) your EE self-ID — POPIA-protected, only used with your consent.', href: '/app', cta: profileDone ? 'Update' : 'Add CV', status: profileDone ? 'Added' : 'Missing' },
    { done: doneN >= 6, title: 'Take the six assessments', desc: 'Aptitude, Technical, Cognitive, Personality, Culture-Fit and Integrity — taken once, reused everywhere.', href: '/app', cta: doneN >= 6 ? 'Review' : 'Take tests', status: doneN + '/6 done' },
    { done: hasScore, title: 'Generate your CALIBR Score', desc: 'Turn your assessments into one verified, shareable Score employers can trust.', href: '/app', cta: hasScore ? 'View Score' : 'Generate', status: hasScore ? 'Issued' : (doneN >= 6 ? 'Ready' : 'Do tests first') },
    { done: false, title: 'Optimise your CV against a job', desc: 'Paste any job ad and see your match %, missing keywords and a tailored rewrite.', href: '/app/cv', cta: 'Open ATS Optimizer', status: 'Anytime' },
  ];
  res.send(shell({ title: 'Setup', user: req.user, body: setupPage('Welcome to CALIBR', 'A few steps to build your verified Score and start applying.', steps, '/app') }));
});

app.get('/app/assess/:type', requireAuth, requireRole('seeker'), (req, res) => {
  const a = BANK[req.params.type]; if (!a) return res.redirect('/app');
  // Anti-cheat: present questions in a shuffled order (names keep the ORIGINAL index so grading is unaffected).
  const order = a.q.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor((i * 2654435761) % (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  const mins = Math.max(3, Math.ceil(a.q.length * 0.75));
  const qs = order.map((oi, pos) => { const q = a.q[oi]; return `<div class="q"><p>${pos + 1}. ${esc(q.t)}</p>${q.o.map((o, j) => `<label><input type="radio" name="q${oi}" value="${j}" required> ${esc(o)}</label>`).join('')}</div>`; }).join('');
  res.send(shell({ title: a.label, user: req.user, body: `
    <h1>${esc(a.label)}<em>.</em></h1><p class="sub">${esc(a.blurb)} Answer honestly — it feeds your Score.</p>
    <div class="msg" id="proctor">⏱ Time remaining: <b id="timer">${mins}:00</b> · switching tabs is recorded to keep scores fair.</div>
    <form method="post" action="/app/assess/${req.params.type}" id="af">
      <input type="hidden" name="_focuslost" id="fl" value="0">
      ${qs}<button class="btn">Submit &amp; score</button> <a class="btn g" href="/app">Cancel</a></form>
    <script>(function(){var s=${mins}*60,t=document.getElementById('timer'),fl=document.getElementById('fl'),lost=0;
      var iv=setInterval(function(){s--;if(s<=0){clearInterval(iv);document.getElementById('af').submit();return;}
        var m=Math.floor(s/60),ss=s%60;t.textContent=m+':'+(ss<10?'0':'')+ss;},1000);
      document.addEventListener('visibilitychange',function(){if(document.hidden){lost++;fl.value=lost;
        var p=document.getElementById('proctor');p.innerHTML='⚠ Tab switch recorded ('+lost+'). Stay on this page.';p.style.borderLeftColor='#c33';}});})();</script>` }));
});

app.post('/app/assess/:type', requireAuth, requireRole('seeker'), (req, res) => {
  const type = req.params.type; if (!BANK[type]) return res.redirect('/app');
  const sc = grade(type, req.body);
  const rawObj = Object.fromEntries(BANK[type].q.map((q, i) => ['q' + i, parseInt(req.body['q' + i], 10)]));
  rawObj._focuslost = parseInt(req.body._focuslost, 10) || 0;
  const raw = JSON.stringify(rawObj);
  const ex = db.get('SELECT id FROM assessments WHERE user_id=? AND type=?', req.user.id, type);
  if (ex) db.run('UPDATE assessments SET status=?,score=?,raw=?,taken_at=? WHERE id=?', 'done', sc, raw, now(), ex.id);
  else db.run('INSERT INTO assessments (user_id,type,status,score,raw,taken_at) VALUES (?,?,?,?,?,?)', req.user.id, type, 'done', sc, raw, now());
  res.redirect('/app');
});

app.post('/app/score', requireAuth, requireRole('seeker'), (req, res) => {
  const rows = db.all('SELECT type,score FROM assessments WHERE user_id=? AND status=?', req.user.id, 'done');
  if (rows.length < 6) return res.redirect('/app');
  const m = Object.fromEntries(rows.map(r => [r.type, r.score]));
  const axes = {
    'Skills / Technical': m.technical,
    'Aptitude / Cognitive': Math.round((m.aptitude + m.cognitive) / 2),
    'Personality': m.personality,
    'Culture-Fit': m.culture,
    'Integrity': m.integrity,
  };
  const composite = Math.round(Object.values(axes).reduce((a, b) => a + b, 0) / Object.values(axes).length);
  const token = crypto.randomBytes(6).toString('hex');
  db.run('INSERT INTO scores (user_id,composite,axes,token,issued_at) VALUES (?,?,?,?,?)', req.user.id, composite, JSON.stringify(axes), token, now());
  res.redirect('/app');
});

app.post('/app/profile', requireAuth, requireRole('seeker'), (req, res) => {
  db.run('UPDATE users SET ee_race=?, ee_gender=?, cv=? WHERE id=?', req.body.ee_race || null, req.body.ee_gender || null, req.body.cv || null, req.user.id);
  res.redirect('/app');
});

// ---------- ATS OPTIMIZER (CV × specific job ad) ----------
function matchBar(pct) {
  const c = pct >= 75 ? 'var(--pink)' : pct >= 50 ? '#e0a11a' : '#c33';
  return `<div class="ats-gauge"><div class="ats-num" style="color:${c}">${pct}<span>%</span></div><div class="bar big"><i style="width:${pct}%;background:${c}"></i></div><div class="l">ATS match to this job</div></div>`;
}
app.get('/app/cv', requireAuth, requireRole('seeker'), (req, res) => {
  const engines = Object.keys(ats.ATS_ENGINES);
  res.send(shell({ title: 'ATS Optimizer', user: req.user, body: `
    <h1>ATS Optimizer<em>.</em></h1><p class="sub">Paste your CV <b>and the actual job ad</b>. CALIBR scores your match, shows the exact keywords you're missing, flags what breaks the ATS, then rewrites your CV against that job — truthfully.</p>
    ${llm.hasKey() ? `<div class="msg">AI rewrite ready · ${esc(llm.provider())}. Match scoring &amp; keyword gaps work with or without AI.</div>` : '<div class="msg">Match scoring, keyword gaps and parse-safety work now. Add <b>ANTHROPIC_API_KEY</b> to <b>app/.env</b> to also get the AI rewrite.</div>'}
    <form method="post" action="/app/cv">
      <div class="fld inline">
        <div style="flex:1"><label>Target ATS (optional)</label><select name="engine">${engines.map(e => `<option${e === 'Generic' ? ' selected' : ''}>${e}</option>`).join('')}</select></div>
      </div>
      <div class="fld"><label>Paste the job ad</label><textarea name="jd" required placeholder="Paste the full job advert here — this is what your CV is scored against" style="min-height:180px"></textarea></div>
      <div class="fld"><label>Your CV</label><textarea name="cv" required style="min-height:220px">${esc(req.user.cv || '')}</textarea></div>
      <button class="btn">Score &amp; optimise</button>
    </form>` }));
});
app.post('/app/cv', requireAuth, requireRole('seeker'), async (req, res) => {
  const cv = (req.body.cv || '').slice(0, 9000), jd = (req.body.jd || '').slice(0, 7000), engine = (req.body.engine || 'Generic').slice(0, 40);
  if (!cv || !jd) return res.redirect('/app/cv');
  db.run('UPDATE users SET cv=? WHERE id=?', cv, req.user.id);
  const r = await ats.optimizeCV(cv, jd, engine);
  const chips = (arr, cls) => (arr && arr.length) ? arr.map(k => `<span class="chip ${cls}">${esc(k)}</span>`).join('') : '<span class="sub">none</span>';
  const delta = r.rewritten ? (r.after - r.before) : 0;
  res.send(shell({ title: 'ATS result', user: req.user, body: `
    <h1>Your ATS result<em>.</em></h1><p class="sub">Scored against the job you pasted · ATS: ${esc(r.engine)} · <a href="/app/cv" style="color:var(--pink);font-weight:700">run another</a></p>
    <div class="ats-grid">
      ${matchBar(r.before)}
      ${r.rewritten ? `<div class="ats-delta"><div class="ats-num" style="color:var(--pink)">${r.after}<span>%</span></div><div class="l">After CALIBR rewrite ${delta >= 0 ? '▲ +' + delta : delta}</div></div>` : ''}
    </div>
    <div class="lbl">Matched keywords</div><div class="chips">${chips(r.matched, 'ok')}</div>
    <div class="lbl">Missing — add these (only if true for you) · <span style="color:#c33">*</span> = must-have</div><div class="chips">${chips(r.missing, 'miss')}</div>
    ${r.flags && r.flags.length ? `<div class="lbl">Parse-safety flags</div><ul class="flags">${r.flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${r.error ? `<div class="err">AI rewrite unavailable: ${esc(r.error)}</div>` : ''}
    ${r.rewritten ? `
      ${r.tips && r.tips.length ? `<div class="lbl">ATS tips for this job</div><ul class="flags">${r.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="lbl">Your rewritten, ATS-optimised CV</div>
      <div class="q" style="white-space:pre-wrap;font-size:14px;line-height:1.6">${esc(r.rewritten)}</div>`
      : `<div class="msg">${r.hasLLM ? '' : 'Add an API key to <b>app/.env</b> to also get the full AI rewrite of your CV against this job.'}</div>`}
    <a class="btn g" href="/app">Back to dashboard</a>` }));
});

// ---------- MOCK INTERVIEW ----------
app.get('/app/interview', requireAuth, requireRole('seeker'), (req, res) => {
  const hist = db.all('SELECT id, role, score, created_at FROM interviews WHERE user_id=? ORDER BY id DESC LIMIT 8', req.user.id);
  res.send(shell({ title: 'Mock Interview', user: req.user, body: `
    <h1>AI Mock Interview<em>.</em></h1><p class="sub">Practise role-specific questions and get honest feedback on each answer.${llm.hasKey() ? '' : ' (Add an API key for AI feedback; structured scoring works now.)'}</p>
    <form method="post" action="/app/interview/start">
      <div class="fld"><label>Role you're practising for</label><input name="role" required placeholder="e.g. Financial Accountant"></div>
      <div class="fld"><label>Paste the job ad (optional — sharpens the questions)</label><textarea name="jd" style="min-height:120px"></textarea></div>
      <button class="btn">Start interview</button>
    </form>
    ${hist.length ? `<div class="lbl">Past sessions</div><div class="table-wrap"><table><tr><th>Role</th><th>Score</th><th>Date</th><th></th></tr>${hist.map(h => `<tr><td>${esc(h.role || '—')}</td><td><b style="color:var(--pink)">${h.score != null ? h.score : '—'}</b></td><td>${esc((h.created_at || '').slice(0, 10))}</td><td><a class="btn sm g" href="/app/interview/${h.id}">Review</a></td></tr>`).join('')}</table></div>` : ''}` }));
});
app.post('/app/interview/start', requireAuth, requireRole('seeker'), async (req, res) => {
  const role = (req.body.role || 'the role').slice(0, 120), jd = (req.body.jd || '').slice(0, 4000);
  const qs = await coach.interviewQuestions(role, jd);
  res.send(shell({ title: 'Mock Interview', user: req.user, body: `
    <h1>Interview · ${esc(role)}<em>.</em></h1><p class="sub">Answer each in the box. Aim for STAR: Situation, Task, Action, Result.</p>
    <form method="post" action="/app/interview/submit">
      <input type="hidden" name="role" value="${esc(role)}">
      ${qs.map((q, i) => `<input type="hidden" name="q${i}" value="${esc(q)}"><div class="q"><p>${i + 1}. ${esc(q)}</p><textarea name="a${i}" style="min-height:120px" placeholder="Your answer"></textarea></div>`).join('')}
      <button class="btn">Get my feedback</button>
    </form>` }));
});
app.post('/app/interview/submit', requireAuth, requireRole('seeker'), async (req, res) => {
  const role = (req.body.role || 'the role').slice(0, 120);
  const qa = []; for (let i = 0; i < 10; i++) { if (req.body['q' + i] == null) break; qa.push({ q: req.body['q' + i], a: (req.body['a' + i] || '').slice(0, 3000) }); }
  const fb = await coach.interviewFeedback(role, qa);
  db.run('INSERT INTO interviews (user_id,role,qa,score,created_at) VALUES (?,?,?,?,?)', req.user.id, role, JSON.stringify(fb.items), fb.overall, now());
  res.send(shell({ title: 'Interview feedback', user: req.user, body: interviewResultHtml(role, fb) }));
});
app.get('/app/interview/:id', requireAuth, requireRole('seeker'), (req, res) => {
  const iv = db.get('SELECT * FROM interviews WHERE id=? AND user_id=?', req.params.id, req.user.id);
  if (!iv) return res.redirect('/app/interview');
  let items = []; try { items = JSON.parse(iv.qa || '[]'); } catch (e) {}
  res.send(shell({ title: 'Interview review', user: req.user, body: interviewResultHtml(iv.role, { overall: iv.score, summary: '', items, engine: '' }) }));
});
function interviewResultHtml(role, fb) {
  return `<h1>Feedback · ${esc(role)}<em>.</em></h1>
    <div class="ats-grid">${matchBar(fb.overall)}</div>
    ${fb.summary ? `<div class="msg">${esc(fb.summary)}</div>` : ''}
    ${fb.items.map((it, i) => `<div class="q"><p>${i + 1}. ${esc(it.q)}</p>
      <div style="white-space:pre-wrap;font-size:14px;margin-bottom:8px">${esc(it.a || '(no answer)')}</div>
      <div class="msg" style="margin:0"><b>Score ${it.score != null ? it.score : '—'}</b> · ${esc(it.feedback || '')}</div></div>`).join('')}
    <a class="btn g" href="/app/interview">New interview</a> <a class="btn g" href="/app">Dashboard</a>`;
}

// ---------- COVER LETTERS ----------
app.get('/app/cover-letters', requireAuth, requireRole('seeker'), (req, res) => {
  const hist = db.all('SELECT id, role_title, company, created_at FROM cover_letters WHERE user_id=? ORDER BY id DESC LIMIT 10', req.user.id);
  res.send(shell({ title: 'Cover Letters', user: req.user, body: `
    <h1>Cover Letters<em>.</em></h1><p class="sub">Generate a tailored letter from your CV and the job.${llm.hasKey() ? '' : ' (A structured template is produced now; add an API key for a fully written letter.)'}</p>
    <form method="post" action="/app/cover-letters">
      <div class="fld inline"><div style="flex:1"><label>Role</label><input name="role" required placeholder="e.g. Store Supervisor"></div><div style="flex:1"><label>Company (optional)</label><input name="company"></div></div>
      <div class="fld"><label>Paste the job ad (optional)</label><textarea name="jd" style="min-height:120px"></textarea></div>
      <div class="fld"><label>Your CV</label><textarea name="cv" required style="min-height:180px">${esc(req.user.cv || '')}</textarea></div>
      <button class="btn">Generate cover letter</button>
    </form>
    ${hist.length ? `<div class="lbl">Saved letters</div><div class="table-wrap"><table><tr><th>Role</th><th>Company</th><th>Date</th><th></th></tr>${hist.map(h => `<tr><td>${esc(h.role_title || '—')}</td><td>${esc(h.company || '—')}</td><td>${esc((h.created_at || '').slice(0, 10))}</td><td><a class="btn sm g" href="/app/cover-letters/${h.id}">Open</a></td></tr>`).join('')}</table></div>` : ''}` }));
});
app.post('/app/cover-letters', requireAuth, requireRole('seeker'), async (req, res) => {
  const role = (req.body.role || 'the role').slice(0, 120), company = (req.body.company || '').slice(0, 120), cv = (req.body.cv || '').slice(0, 6000), jd = (req.body.jd || '').slice(0, 4000);
  if (cv) db.run('UPDATE users SET cv=? WHERE id=?', cv, req.user.id);
  const r = await coach.coverLetter(req.user.name, role, company, cv, jd);
  let id = null;
  if (r.body) { const ins = db.run('INSERT INTO cover_letters (user_id,role_title,company,body,created_at) VALUES (?,?,?,?,?)', req.user.id, role, company || null, r.body, now()); id = Number(ins.lastInsertRowid); }
  res.send(shell({ title: 'Cover letter', user: req.user, body: `
    <h1>Your cover letter<em>.</em></h1><p class="sub">${esc(role)}${company ? ' · ' + esc(company) : ''} · <a href="/app/cover-letters" style="color:var(--pink);font-weight:700">new letter</a></p>
    ${r.error ? `<div class="err">AI unavailable: ${esc(r.error)}</div>` : ''}
    <div class="q" style="white-space:pre-wrap;font-size:14px;line-height:1.7">${esc(r.body || 'No output.')}</div>
    <a class="btn g" href="/app">Dashboard</a>` }));
});
app.get('/app/cover-letters/:id', requireAuth, requireRole('seeker'), (req, res) => {
  const cl = db.get('SELECT * FROM cover_letters WHERE id=? AND user_id=?', req.params.id, req.user.id);
  if (!cl) return res.redirect('/app/cover-letters');
  res.send(shell({ title: 'Cover letter', user: req.user, body: `
    <h1>Cover letter<em>.</em></h1><p class="sub">${esc(cl.role_title || '')}${cl.company ? ' · ' + esc(cl.company) : ''}</p>
    <div class="q" style="white-space:pre-wrap;font-size:14px;line-height:1.7">${esc(cl.body)}</div>
    <a class="btn g" href="/app/cover-letters">Back</a>` }));
});

// ---------- GROWTH PATH ----------
app.get('/app/growth', requireAuth, requireRole('seeker'), async (req, res) => {
  const score = db.get('SELECT * FROM scores WHERE user_id=? ORDER BY id DESC LIMIT 1', req.user.id);
  if (!score) return res.send(shell({ title: 'Growth Path', user: req.user, body: `<h1>Growth Path<em>.</em></h1><div class="msg">Generate your CALIBR Score first — your roadmap is built from your per-axis results. <a href="/app" style="color:var(--pink);font-weight:700">Take the assessments</a>.</div>` }));
  const axes = JSON.parse(score.axes);
  const target = (req.query.role || '').slice(0, 120);
  const g = await coach.growthPath(axes, target);
  res.send(shell({ title: 'Growth Path', user: req.user, body: `
    <h1>Your Growth Path<em>.</em></h1><p class="sub">Built from your CALIBR Score${target ? ' · targeting ' + esc(target) : ''}.</p>
    <form method="get" action="/app/growth" class="fld inline" style="margin-bottom:8px"><div style="flex:1"><label>Target role (optional)</label><input name="role" value="${esc(target)}" placeholder="e.g. Data Analyst"></div><div style="display:flex;align-items:flex-end"><button class="btn sm">Re-plan</button></div></form>
    ${g.focus && g.focus.length ? `<div class="msg"><b>Focus:</b> ${g.focus.map(esc).join(' ')}</div>` : ''}
    <div class="lbl">Your roadmap</div>
    ${g.steps.map((s, i) => `<div class="q"><p>${i + 1}. ${esc(s.title)}${s.axis ? ` <span class="chip miss">${esc(s.axis)}</span>` : ''}</p><div style="font-size:14px">${esc(s.detail)}</div></div>`).join('')}
    ${g.quickWins && g.quickWins.length ? `<div class="lbl">Quick wins this month</div><ul class="flags">${g.quickWins.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <a class="btn g" href="/app">Dashboard</a>` }));
});

// ---------- MY APPLICATIONS + SAVED JOBS ----------
app.get('/app/applications', requireAuth, requireRole('seeker'), (req, res) => {
  const apps = db.all('SELECT a.*, r.title, c.name company, r.public_token FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN companies c ON c.id=r.company_id WHERE a.user_id=? ORDER BY a.id DESC', req.user.id);
  const saved = db.all('SELECT s.id sid, r.title, c.name company, r.public_token, r.location FROM saved_jobs s JOIN roles_posted r ON r.id=s.role_id JOIN companies c ON c.id=r.company_id WHERE s.user_id=? ORDER BY s.id DESC', req.user.id);
  res.send(shell({ title: 'My Applications', user: req.user, body: `
    <h1>My Applications<em>.</em></h1>
    <div class="lbl">Applied (${apps.length})</div>
    ${apps.length ? `<div class="table-wrap"><table><tr><th>Role</th><th>Company</th><th>JD match</th><th>Stage</th><th></th></tr>${apps.map(a => `<tr><td><b>${esc(a.title)}</b></td><td>${esc(a.company)}</td><td>${a.jd_match != null ? a.jd_match + '%' : '—'}</td><td><span class="pill ${a.stage === 'Hired' ? 'done' : 'todo'}">${esc(a.stage)}</span></td><td><a class="btn sm g" href="/jobs/${a.public_token}">View job</a></td></tr>`).join('')}</table></div>` : '<p class="sub">No applications yet. <a href="/jobs" style="color:var(--pink);font-weight:700">Browse jobs</a>.</p>'}
    <div class="lbl">Saved jobs (${saved.length})</div>
    ${saved.length ? `<div class="grid">${saved.map(s => `<div class="card"><h3 style="margin:0">${esc(s.title)}</h3><p>${esc(s.company)}${s.location ? ' · ' + esc(s.location) : ''}</p><a class="btn sm" href="/jobs/${s.public_token}">Apply</a> <form method="post" action="/app/saved/${s.sid}/remove" style="display:inline"><button class="btn sm g">Remove</button></form></div>`).join('')}</div>` : '<p class="sub">No saved jobs yet.</p>'}` }));
});
app.post('/jobs/:token/save', requireAuth, requireRole('seeker'), (req, res) => {
  const role = db.get('SELECT id FROM roles_posted WHERE public_token=?', req.params.token);
  if (role) { try { db.run('INSERT INTO saved_jobs (user_id,role_id,created_at) VALUES (?,?,?)', req.user.id, role.id, now()); } catch (e) {} }
  res.redirect('/jobs/' + req.params.token);
});
app.post('/app/saved/:id/remove', requireAuth, requireRole('seeker'), (req, res) => {
  db.run('DELETE FROM saved_jobs WHERE id=? AND user_id=?', req.params.id, req.user.id);
  res.redirect('/app/applications');
});

// ---------- SCORE HISTORY + PRINTABLE CARD ----------
app.get('/app/score', requireAuth, requireRole('seeker'), (req, res) => {
  const hist = db.all('SELECT * FROM scores WHERE user_id=? ORDER BY id DESC', req.user.id);
  if (!hist.length) return res.redirect('/app');
  const latest = hist[0]; const axes = JSON.parse(latest.axes);
  res.send(shell({ title: 'CALIBR Score', user: req.user, body: `
    <h1>Your CALIBR Score<em>.</em></h1>
    <div class="score-hero"><div><div class="score-num">${latest.composite}</div><div class="badge-verified">✔ Verified</div></div>
      <div style="flex:1">${Object.entries(axes).map(([k, v]) => `<div class="axis"><span>${esc(k)}</span><b>${v}</b></div><div class="bar"><i style="width:${v}%"></i></div>`).join('')}</div></div>
    <div class="actions"><a class="btn sm" href="/app/score/card/${latest.token}" target="_blank">Print / save score card (PDF)</a> <a class="btn sm g" href="/verify/${latest.token}" target="_blank">Public verify link</a></div>
    <div class="lbl">Score history (${hist.length})</div>
    <div class="table-wrap"><table><tr><th>Issued</th><th>Composite</th>${AXES.map(a => `<th>${esc(a.split(' ')[0])}</th>`).join('')}<th></th></tr>
    ${hist.map(s => { const a = JSON.parse(s.axes); return `<tr><td>${esc(s.issued_at.slice(0, 10))}</td><td><b style="color:var(--pink)">${s.composite}</b></td>${AXES.map(k => `<td>${a[k] != null ? a[k] : '—'}</td>`).join('')}<td><a class="btn sm g" href="/verify/${s.token}" target="_blank">Verify</a></td></tr>`; }).join('')}</table></div>
    <a class="btn g" href="/app">Dashboard</a>` }));
});
app.get('/app/score/card/:token', requireAuth, requireRole('seeker'), (req, res) => {
  const s = db.get('SELECT s.*, u.name FROM scores s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.user_id=?', req.params.token, req.user.id);
  if (!s) return res.redirect('/app/score');
  const axes = JSON.parse(s.axes);
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CALIBR Score Card</title>
    <style>@page{size:A4;margin:18mm}body{font-family:-apple-system,Arial,sans-serif;color:#000;max-width:720px;margin:0 auto}
    .top{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #000;padding-bottom:12px}
    .big{font-size:96px;font-weight:900;letter-spacing:-.04em;line-height:1}.pink{color:#FF1F70}
    .ax{display:flex;justify-content:space-between;font-weight:700;margin:14px 0 3px}.bar{height:10px;background:#f0f0f0}.bar i{display:block;height:100%;background:#FF1F70}
    .v{display:inline-block;border:2px solid #000;padding:4px 10px;font-weight:800;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
    @media print{.noprint{display:none}}</style></head><body onload="window.print&&setTimeout(()=>window.print(),300)">
    <div class="top"><div><div style="font-weight:900;font-size:26px;letter-spacing:-.03em">Calibr<span class="pink">.</span></div><div style="font-size:13px;color:#555">Verified CALIBR Score</div></div><div class="v">✔ Verified</div></div>
    <h1 style="font-size:24px;margin:18px 0 2px">${esc(s.name)}</h1>
    <p style="color:#555;margin:0 0 10px">Issued ${esc(s.issued_at.slice(0, 10))} · verify at /verify/${esc(s.token)}</p>
    <div class="big pink">${s.composite}<span style="font-size:28px;color:#000">/100</span></div>
    <div style="margin-top:20px">${Object.entries(axes).map(([k, v]) => `<div class="ax"><span>${esc(k)}</span><span>${v}</span></div><div class="bar"><i style="width:${v}%"></i></div>`).join('')}</div>
    <p style="margin-top:26px;font-size:11px;color:#777">This score is server-issued by CALIBR and tamper-proof. A product of KTH-Tech · Reg 2025/627290/07 · POPIA-first. Assessment validation & bias testing per CALIBR's I-O methodology.</p>
    <button class="noprint" onclick="window.print()" style="margin-top:14px;padding:10px 18px;background:#FF1F70;color:#fff;border:0;font-weight:700;cursor:pointer">Print / Save as PDF</button>
    </body></html>`);
});

// ---------- PUBLIC SCORE VERIFY ----------
app.get('/verify/:token', (req, res) => {
  const s = db.get('SELECT s.*, u.name FROM scores s JOIN users u ON u.id=s.user_id WHERE s.token=?', req.params.token);
  if (!s) return res.status(404).send(shell({ title: 'Not found', body: '<h1>Score not found<em>.</em></h1><p class="sub">This verification link is invalid or was revoked.</p>' }));
  const axes = JSON.parse(s.axes);
  res.send(shell({ title: 'Verified Score', body: `
    <div class="score-hero"><div><div class="score-num">${s.composite}</div><div class="badge-verified">✔ Verified by CALIBR</div></div>
    <div style="flex:1"><h2>${esc(s.name)}</h2>${Object.entries(axes).map(([k, v]) => `<div class="axis"><span>${esc(k)}</span><b>${v}</b></div><div class="bar"><i style="width:${v}%"></i></div>`).join('')}</div></div>
    <p class="sub">Issued ${esc(s.issued_at.slice(0,10))} · token ${esc(s.token)}. This score is server-issued and tamper-proof.</p>` }));
});

// ---------- PUBLIC JOB BOARD / APPLY ----------
app.get('/jobs', (req, res) => {
  const roles = db.all(`SELECT r.*, c.name company FROM roles_posted r JOIN companies c ON c.id=r.company_id WHERE r.is_public=1 AND r.public_token IS NOT NULL AND r.status='open' ORDER BY r.id DESC`);
  res.send(shell({ title: 'Jobs', user: user(req), body: `
    <h1>Open roles<em>.</em></h1><p class="sub">Apply once — your CV is scored against the job instantly, and your CALIBR Score travels with it.</p>
    ${roles.length ? `<div class="grid">${roles.map(r => `<div class="card"><h3 style="margin:0">${esc(r.title)}</h3><p>${esc(r.company)}${r.location ? ' · ' + esc(r.location) : ''}${r.emp_type ? ' · ' + esc(r.emp_type) : ''}</p>${(r.salary_min || r.salary_max) ? `<p class="sub" style="margin:0">R${Number(r.salary_min || r.salary_max).toLocaleString('en-US')}${r.salary_max && r.salary_min ? '–R' + Number(r.salary_max).toLocaleString('en-US') : ''}/yr</p>` : ''}<a class="btn sm" href="/jobs/${r.public_token}">View &amp; apply</a></div>`).join('')}</div>` : '<p class="sub">No open roles right now.</p>'}` }));
});

app.get('/jobs/:token', (req, res) => {
  const role = db.get(`SELECT r.*, c.name company FROM roles_posted r JOIN companies c ON c.id=r.company_id WHERE r.public_token=? AND r.is_public=1`, req.params.token);
  if (!role) return res.status(404).send(shell({ title: 'Not found', body: '<h1>Role not found<em>.</em></h1><p class="sub">This job link is invalid or the role was closed.</p>' }));
  const jsonld = distribute.jobPostingJsonLd(role, { name: role.company }, absUrl(req, '/jobs/' + role.public_token));
  const me = user(req);
  const isSeeker = me && me.role === 'seeker';
  const isSaved = isSeeker && db.get('SELECT 1 s FROM saved_jobs WHERE user_id=? AND role_id=?', me.id, role.id);
  res.send(shell({ title: role.title + ' · ' + role.company, user: me, head: jsonld, body: `
    <h1>${esc(role.title)}<em>.</em></h1>
    <p class="sub">${esc(role.company)}${role.location ? ' · ' + esc(role.location) : ''}${role.emp_type ? ' · ' + esc(role.emp_type) : ''}${(role.salary_min || role.salary_max) ? ' · R' + Number(role.salary_min || role.salary_max).toLocaleString('en-US') + (role.salary_max && role.salary_min ? '–R' + Number(role.salary_max).toLocaleString('en-US') : '') + '/yr' : ''}</p>
    <div class="actions"><a class="btn" href="/jobs/${role.public_token}/apply">Apply now</a>${isSeeker ? (isSaved ? '<span class="pill done" style="align-self:center">Saved</span>' : `<form method="post" action="/jobs/${role.public_token}/save" style="display:inline"><button class="btn g">Save job</button></form>`) : ''}</div>
    <div class="lbl">About the role</div>
    <div class="q" style="white-space:pre-wrap;font-size:14px;line-height:1.65">${esc(role.description || 'No description provided.')}</div>
    <a class="btn" href="/jobs/${role.public_token}/apply">Apply now</a>` }));
});

app.get('/jobs/:token/apply', (req, res) => {
  const role = db.get('SELECT r.*, c.name company FROM roles_posted r JOIN companies c ON c.id=r.company_id WHERE r.public_token=? AND r.is_public=1', req.params.token);
  if (!role) return res.redirect('/jobs');
  const u = user(req);
  res.send(shell({ title: 'Apply · ' + role.title, user: u, body: `
    <h1>Apply · ${esc(role.title)}<em>.</em></h1><p class="sub">${esc(role.company)} — your CV is checked against this job the moment you apply.</p>
    <form method="post" action="/jobs/${role.public_token}/apply">
      <div class="fld inline"><div style="flex:1"><label>Full name</label><input name="name" required value="${esc(u ? u.name : '')}"></div><div style="flex:1"><label>Email</label><input type="email" name="email" required value="${esc(u ? u.email : '')}"></div></div>
      <div class="fld"><label>WhatsApp number (for updates)</label><input name="phone" placeholder="082 123 4567" value="${esc(u && u.phone || '')}"><span class="sub" style="font-size:11px">We'll send your application status and interview invites here. Optional.</span></div>
      <div class="fld"><label>Paste your CV</label><textarea name="cv" required style="min-height:240px" placeholder="Paste your CV text">${esc(u && u.cv || '')}</textarea></div>
      <div class="fld" style="font-size:12px;color:var(--grey)"><label style="text-transform:none;letter-spacing:0;font-weight:500"><input type="checkbox" name="consent" required style="width:auto;margin-right:8px">I consent to ${esc(role.company)} and CALIBR processing this application per the POPIA-aligned privacy policy.</label></div>
      <button class="btn">Submit application</button>
    </form>` }));
});

app.post('/jobs/:token/apply', async (req, res) => {
  const role = db.get('SELECT * FROM roles_posted WHERE public_token=? AND is_public=1', req.params.token);
  if (!role) return res.redirect('/jobs');
  if (!req.body.consent) return res.redirect('/jobs/' + role.public_token + '/apply');
  const name = (req.body.name || '').slice(0, 120), email = (req.body.email || '').toLowerCase().slice(0, 160), cv = (req.body.cv || '').slice(0, 9000), phone = (req.body.phone || '').slice(0, 30) || null;
  if (!email || !cv) return res.redirect('/jobs/' + role.public_token + '/apply');
  // find-or-create a candidate account (external applicants become seekers so they can claim their profile later)
  let u = db.get('SELECT * FROM users WHERE email=?', email);
  if (!u) {
    const hash = bcrypt.hashSync(crypto.randomBytes(9).toString('hex'), 10);
    const ins = db.run('INSERT INTO users (role,name,email,pass,consent_at,cv,phone,created_at) VALUES (?,?,?,?,?,?,?,?)', 'seeker', name || email, email, hash, now(), cv, phone, now());
    u = db.get('SELECT * FROM users WHERE id=?', Number(ins.lastInsertRowid));
  } else {
    db.run('UPDATE users SET cv=?, phone=COALESCE(?,phone) WHERE id=?', cv, phone, u.id);
  }
  // score CV against THIS job
  let kws = roleKeywords(role);
  if (!kws.length && role.description) { try { const p = await reindexRole(role); kws = p ? p.keywords : []; } catch (e) {} }
  const scored = await ats.scoreCV(cv, kws, role.description || role.title);
  // blend JD match with the candidate's CALIBR composite (if they have one)
  const sc = db.get('SELECT composite FROM scores WHERE user_id=? ORDER BY id DESC LIMIT 1', u.id);
  const fit = sc ? Math.round(0.6 * scored.match + 0.4 * sc.composite) : scored.match;
  const report = JSON.stringify({ matched: scored.matched, missing: scored.missing, flags: scored.flags, summary: scored.summary || '', seniority_fit: scored.seniority_fit || '', engine: scored.engine });
  const ex = db.get('SELECT id FROM applications WHERE role_id=? AND user_id=?', role.id, u.id);
  if (ex) db.run('UPDATE applications SET jd_match=?, jd_report=?, cv_text=?, fit=?, source=? WHERE id=?', scored.match, report, cv, fit, 'public', ex.id);
  else db.run('INSERT INTO applications (role_id,user_id,stage,fit,jd_match,jd_report,cv_text,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)', role.id, u.id, 'New', fit, scored.match, report, cv, 'public', now());
  if (phone) { const co = db.get('SELECT name FROM companies WHERE id=?', role.company_id) || {}; notify.fire(phone, notify.T.applied(name, role.title, co.name || 'the company')); }
  if (webhooks) webhooks.fireWebhook(role.company_id, 'application.created', { role_id: role.id, role_title: role.title, candidate: name, email, jd_match: scored.match, fit, source: 'public' });
  res.send(shell({ title: 'Applied', user: user(req), body: `
    <div style="text-align:center;padding:40px 0">
      <h1>Application received<em>.</em></h1>
      <p class="sub">Your CV was scored against <b>${esc(role.title)}</b>.</p>
      ${matchBar(scored.match)}
      ${scored.missing && scored.missing.length ? `<div class="lbl">To strengthen your application, address:</div><div class="chips">${scored.missing.slice(0, 10).map(k => `<span class="chip miss">${esc(k)}</span>`).join('')}</div>` : ''}
      <p class="sub" style="margin-top:20px">Want this to carry a <b>verified CALIBR Score</b> to every employer? <a href="/signup" style="color:var(--pink);font-weight:700">Create your free account</a> and take the assessments.</p>
      <a class="btn g" href="/jobs">Browse more jobs</a>
    </div>` }));
});

// Aggregator feed (Indeed-compatible / generic) — boards that pull feeds ingest this automatically.
app.get('/jobs.xml', (req, res) => {
  const roles = db.all(`SELECT r.*, c.name company FROM roles_posted r JOIN companies c ON c.id=r.company_id WHERE r.is_public=1 AND r.public_token IS NOT NULL AND r.status='open'`);
  const x = s => distribute.esc(s);
  res.type('application/xml').send(`<?xml version="1.0" encoding="utf-8"?>
<source><publisher>CALIBR</publisher><publisherurl>https://calibr-careers.tech</publisherurl>
${roles.map(r => `<job>
<title><![CDATA[${r.title}]]></title>
<date><![CDATA[${(r.created_at || '').slice(0, 10)}]]></date>
<referencenumber>${r.id}</referencenumber>
<url><![CDATA[${absUrl(req, '/jobs/' + r.public_token)}]]></url>
<company><![CDATA[${r.company}]]></company>
<city><![CDATA[${r.location || 'South Africa'}]]></city>
<country>ZA</country>
<jobtype><![CDATA[${r.emp_type || 'Full-time'}]]></jobtype>
${r.salary_min ? `<salary><![CDATA[R${r.salary_min}${r.salary_max ? '-R' + r.salary_max : ''}]]></salary>` : ''}
<description><![CDATA[${(r.description || r.title)}]]></description>
</job>`).join('\n')}
</source>`);
});

// ---------- PUBLIC "TRY THE SCORE" DEMO (no signup) ----------
app.get('/try', (req, res) => {
  res.send(shell({ title: 'Try CALIBR free', user: user(req), body: `
    <div class="eyebrow" style="color:var(--pink);font-weight:800;letter-spacing:.2em;text-transform:uppercase;font-size:11px">Free · no signup</div>
    <h1>Score your CV against any job<em>.</em></h1>
    <p class="sub">Paste your CV and a job ad — CALIBR scores the match, shows what's missing, and flags what an ATS would trip on. This is the real engine, free.</p>
    <form method="post" action="/try">
      <div class="fld inline">
        <div style="flex:1"><label>Your CV</label><textarea name="cv" required style="min-height:220px" placeholder="Paste your CV text">${esc((req.query.cv || '').slice(0, 9000))}</textarea></div>
        <div style="flex:1"><label>The job ad</label><textarea name="jd" required style="min-height:220px" placeholder="Paste the job advert / description"></textarea></div>
      </div>
      <button class="btn">Score my match — free</button>
    </form>` }));
});
app.post('/try', async (req, res) => {
  const cv = (req.body.cv || '').slice(0, 9000), jd = (req.body.jd || '').slice(0, 7000);
  if (!cv || !jd) return res.redirect('/try');
  const r = await ats.optimizeCV(cv, jd, 'Generic');
  const chips = (arr, cls) => (arr && arr.length) ? arr.map(k => `<span class="chip ${cls}">${esc(k)}</span>`).join('') : '<span class="sub">none</span>';
  res.send(shell({ title: 'Your match', user: user(req), body: `
    <h1>Your match<em>.</em></h1><p class="sub">Scored by CALIBR's ATS engine · <a href="/try" style="color:var(--pink);font-weight:700">try another</a></p>
    <div class="ats-grid">${matchBar(r.before)}${r.rewritten ? `<div class="ats-delta"><div class="ats-num" style="color:var(--pink)">${r.after}<span>%</span></div><div class="l">After CALIBR rewrite</div></div>` : ''}</div>
    <div class="lbl">Matched the job on</div><div class="chips">${chips(r.matched, 'ok')}</div>
    <div class="lbl">Missing vs the job</div><div class="chips">${chips(r.missing, 'miss')}</div>
    ${r.flags && r.flags.length ? `<div class="lbl">ATS parse-safety</div><ul class="flags">${r.flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <div class="callout" style="background:var(--paper2,#f7f7f7);border-left:3px solid var(--pink);padding:16px 18px;margin-top:20px;border-radius:12px">
      <b>That's a fraction of what CALIBR does.</b> Create a free account to build a <b>verified CALIBR Score</b> employers trust, practise interviews, and apply to real SA jobs.
      <div class="actions" style="margin-top:12px"><a class="btn sm" href="/signup?role=seeker">Build my Score</a> <a class="btn sm g" href="/jobs">Browse jobs</a></div>
    </div>` }));
});

// ---------- EMPLOYER ----------
app.get('/company', requireAuth, requireRole('employer'), (req, res) => {
  const co = db.get('SELECT * FROM companies WHERE id=?', req.user.company_id) || { name: 'Your company' };
  const roles = db.all('SELECT * FROM roles_posted WHERE company_id=? ORDER BY id DESC', req.user.company_id || 0);
  const poolSize = db.get('SELECT COUNT(DISTINCT user_id) n FROM scores').n;
  const cultureSet = !!companyProfile(req.user.company_id);
  const connMap = companyConnections(req.user.company_id);
  const connCount = distribute.PARTNERS.filter(p => connMap[p.key] && connMap[p.key].status === 'connected').length;
  res.send(shell({ title: 'Company', user: req.user, body: `
    <h1>${esc(co.name)}<em>.</em></h1><p class="sub">Hire on evidence. Screen the pre-scored CALIBR talent pool. · <a href="/company/setup" style="color:var(--pink);font-weight:700">Setup guide</a></p>
    <div class="grid">
      <div class="card"><h3>Talent pool</h3><p>Candidates with a verified CALIBR Score</p><div class="score-num" style="font-size:44px">${poolSize}</div><a class="btn sm" href="/company/pool">Browse pool</a></div>
      <div class="card"><h3>Post a role</h3><p>Write the JD, screen the pool, auto-distribute to job boards, and take applications with JD-scored CVs.</p><a class="btn sm block" href="/company/post">Post a job</a> <a class="btn sm block g" href="/company/jd">✦ AI JD writer</a></div>
      <div class="card"><h3>Fairness audit</h3><p>Adverse-impact (4/5ths rule) across your pipeline</p><a class="btn sm g" href="/company/audit">Run audit</a></div>
      <div class="card"><h3>Careers page</h3><p>Your public branded job board${notify.enabled() ? ' · WhatsApp updates on' : ''}</p><a class="btn sm g" href="/careers/${req.user.company_id}" target="_blank">View careers page</a></div>
      <div class="card"><h3>Analytics</h3><p>Pipeline funnel, time-to-hire &amp; source quality</p><a class="btn sm g" href="/company/analytics">View analytics</a></div>
      <div class="card"><h3>Reports</h3><p>B-BBEE &amp; EE reporting</p><a class="btn sm g" href="/company/reports">View reports</a></div>
      <div class="card"><h3>Culture profile</h3><p>${cultureSet ? 'Defined — scoring is company-relative' : 'Define what your company values'}</p><a class="btn sm ${cultureSet ? 'g' : ''}" href="/company/culture">${cultureSet ? 'Edit profile' : 'Set up profile'}</a></div>
      <div class="card"><h3>Connections</h3><p>${connCount ? connCount + ' of ' + distribute.PARTNERS.length + ' job platforms connected' : 'Connect the job boards you use'}</p><a class="btn sm ${connCount ? 'g' : ''}" href="/company/connections">Manage connections</a></div>
      <div class="card"><h3>API &amp; webhooks</h3><p>Integrate CALIBR with your HRIS &amp; tools</p><a class="btn sm g" href="/company/api">Manage API</a></div>
      <div class="card"><h3>Billing</h3><p>Flat monthly subscription — from R1,499/mo</p><a class="btn sm g" href="/company/billing">View plans</a></div>
    </div>
    <div class="lbl">Open roles</div>
    ${roles.length ? `<div class="table-wrap"><table><tr><th>Role</th><th>Salary</th><th>Applicants</th><th>Posted</th><th></th></tr>${roles.map(r => { const na = db.get('SELECT COUNT(*) n FROM applications WHERE role_id=? AND source=?', r.id, 'public').n; return `<tr><td><b>${esc(r.title)}</b>${r.public_token ? '' : ' <span class="pill todo">draft</span>'}</td><td>${r.salary ? 'R' + Number(r.salary).toLocaleString('en-US') : '—'}</td><td>${na}</td><td>${esc(r.created_at.slice(0,10))}</td><td><a class="btn sm" href="/company/role/${r.id}">Screen</a> <a class="btn sm g" href="/company/role/${r.id}/distribute">Distribute</a></td></tr>`; }).join('')}</table></div>` : '<p class="sub">No roles yet — post one above.</p>'}` }));
});

// Full job-posting form (JD, location, type, salary band)
app.get('/company/post', requireAuth, requireRole('employer'), (req, res) => {
  res.send(shell({ title: 'Post a job', user: req.user, body: `
    <h1>Post a job<em>.</em></h1><p class="sub">Write the advert once. CALIBR extracts the keywords, screens your pool, publishes a public apply page, and scores every applicant's CV against this exact job.</p>
    <form method="post" action="/company/role">
      <div class="fld"><label>Job title</label><input name="title" required placeholder="e.g. Key Account Manager"></div>
      <div class="fld inline">
        <div style="flex:1"><label>Location</label><input name="location" placeholder="e.g. Sandton, Gauteng"></div>
        <div style="flex:1"><label>Type</label><select name="emp_type">${['Full-time','Part-time','Contract','Learnership','Internship'].map(o => `<option>${o}</option>`).join('')}</select></div>
      </div>
      <div class="fld inline">
        <div style="flex:1"><label>Salary min (ZAR/yr)</label><input name="salary_min" type="number" placeholder="e.g. 360000"></div>
        <div style="flex:1"><label>Salary max (ZAR/yr)</label><input name="salary_max" type="number" placeholder="e.g. 540000"></div>
      </div>
      <div class="fld"><label>Job description &amp; requirements</label><textarea name="description" required style="min-height:240px" placeholder="Paste or write the full JD — responsibilities, must-have skills, qualifications, experience. The more real detail, the sharper the keyword match."></textarea></div>
      <button class="btn">Post &amp; extract keywords</button> <a class="btn g" href="/company">Cancel</a>
    </form>` }));
});

app.post('/company/role', requireAuth, requireRole('employer'), async (req, res) => {
  if (!req.body.title) return res.redirect('/company/post');
  const weights = JSON.stringify(Object.fromEntries(AXES.map(k => [k, 20])));
  const salary = req.body.salary_max || req.body.salary || req.body.salary_min || null;
  const r = db.run(`INSERT INTO roles_posted (company_id,title,description,location,emp_type,salary_min,salary_max,salary,weights,is_public,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    req.user.company_id, req.body.title, req.body.description || null, req.body.location || null, req.body.emp_type || 'Full-time',
    req.body.salary_min ? parseInt(req.body.salary_min, 10) : null, req.body.salary_max ? parseInt(req.body.salary_max, 10) : null,
    salary ? parseInt(salary, 10) : null, weights, 1, 'open', now());
  const role = db.get('SELECT * FROM roles_posted WHERE id=?', Number(r.lastInsertRowid));
  ensureToken(role);
  try { await reindexRole(role); } catch (e) {}
  res.redirect('/company/role/' + role.id + '/distribute');
});

// Edit JD / re-extract keywords
app.post('/company/role/:id/jd', requireAuth, requireRole('employer'), async (req, res) => {
  const role = db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!role) return res.redirect('/company');
  db.run('UPDATE roles_posted SET description=?, location=?, emp_type=? WHERE id=?', req.body.description || role.description, req.body.location || role.location, req.body.emp_type || role.emp_type, role.id);
  role.description = req.body.description || role.description;
  try { await reindexRole(role); } catch (e) {}
  res.redirect('/company/role/' + role.id + '/distribute');
});

// Distribution hub for a role
app.get('/company/role/:id/distribute', requireAuth, requireRole('employer'), (req, res) => {
  const role = db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!role) return res.redirect('/company');
  ensureToken(role);
  const pub = absUrl(req, '/jobs/' + role.public_token);
  const conns = companyConnections(req.user.company_id);
  const chans = distribute.channels(role, pub, conns);
  const kws = roleKeywords(role);
  const applicants = db.get('SELECT COUNT(*) n FROM applications WHERE role_id=? AND source=?', role.id, 'public').n;
  const nConn = distribute.PARTNERS.filter(p => conns[p.key] && conns[p.key].status === 'connected').length;
  res.send(shell({ title: 'Distribute: ' + role.title, user: req.user, body: `
    <h1>Distribute · ${esc(role.title)}<em>.</em></h1>
    <p class="sub"><a href="/company/role/${role.id}" style="color:var(--pink);font-weight:700">Screen the pool &rarr;</a> · Public apply page: <a href="${esc(pub)}" target="_blank" style="color:var(--pink);font-weight:700">${esc(pub)}</a> · ${applicants} applicant${applicants === 1 ? '' : 's'}</p>
    <div class="lbl">Where this job goes · <a href="/company/connections" style="color:var(--pink);font-weight:700">manage connections (${nConn}/${distribute.PARTNERS.length})</a></div>
    <div class="table-wrap"><table><tr><th>Channel</th><th>Status</th><th></th><th>Notes</th></tr>
      ${chans.map(c => `<tr><td><b>${esc(c.name)}</b></td><td><span class="pill ${c.connected || c.mode.startsWith('Auto') ? 'done' : 'todo'}">${esc(c.mode)}</span></td><td>${c.kind === 'partner' && !c.connected ? `<a class="btn sm" href="/company/connections">Connect</a>` : (c.link ? `<a class="btn sm g" href="${esc(c.link)}" target="_blank">${c.connected ? 'Open' : 'Share'}</a>` : '')}</td><td style="font-size:12px;color:var(--grey)">${esc(c.note || '')}</td></tr>`).join('')}
    </table></div>
    <div class="lbl">Extracted ATS keywords (${kws.length}) — applicants are scored against these</div>
    <div class="chips">${kws.length ? kws.map(k => `<span class="chip ${k.must ? 'miss' : 'ok'}">${esc(k.term)}</span>`).join('') : '<span class="sub">Add a description below to extract keywords.</span>'}</div>
    <div class="lbl">Job description</div>
    <form method="post" action="/company/role/${role.id}/jd">
      <div class="fld inline"><div style="flex:1"><label>Location</label><input name="location" value="${esc(role.location || '')}"></div><div style="flex:1"><label>Type</label><input name="emp_type" value="${esc(role.emp_type || 'Full-time')}"></div></div>
      <div class="fld"><textarea name="description" style="min-height:220px" placeholder="Paste the JD to extract keywords">${esc(role.description || '')}</textarea></div>
      <button class="btn sm">Save &amp; re-extract keywords</button>
    </form>` }));
});

// ---------- PLATFORM CONNECTIONS (per company) ----------
app.get('/company/connections', requireAuth, requireRole('employer'), (req, res) => {
  const conns = companyConnections(req.user.company_id);
  const rows = distribute.PARTNERS.map(p => {
    const c = conns[p.key];
    const connected = c && c.status === 'connected';
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <h3 style="margin:0">${esc(p.name)}</h3>
        <span class="pill ${connected ? 'done' : 'todo'}">${connected ? 'Connected' : 'Not connected'}</span>
      </div>
      <p>${esc(p.help || '')}</p>
      ${connected
        ? `<p class="sub" style="margin:6px 0">Account: <b>${esc(c.account_label || '—')}</b></p>
           <form method="post" action="/company/connections/${p.key}/disconnect"><button class="btn sm g">Disconnect</button></form>`
        : oauth.ready(p.key)
        ? `<a class="btn sm" href="/company/connections/${p.key}/oauth/start">Sign in with ${esc(p.name)}</a>
           <p class="sub" style="margin-top:8px;font-size:12px">Secure OAuth — you approve access on ${esc(p.name)}; CALIBR never sees your password.</p>`
        : `<form method="post" action="/company/connections/${p.key}">
             <div class="fld"><label>Account name / email on ${esc(p.name)}</label><input name="account_label" required placeholder="e.g. recruiting@yourco.co.za"></div>
             <div class="fld"><label>API token / key <span style="color:var(--grey);font-weight:500;text-transform:none;letter-spacing:0">(from your ${esc(p.name)} account · stored securely, never shown again)</span></label><input name="secret" type="password" placeholder="Paste your ${esc(p.name)} API token"></div>
             <button class="btn sm">Connect ${esc(p.name)}</button>
           </form>${oauth.provider(p.key) ? `<p class="sub" style="margin-top:8px;font-size:12px">One-click sign-in appears here once CALIBR is registered as a ${esc(p.name)} app (set ${esc(oauth.provider(p.key).idEnv)} / ${esc(oauth.provider(p.key).secretEnv)} in app/.env).</p>` : ''}`}
    </div>`;
  }).join('');
  res.send(shell({ title: 'Connections', user: req.user, body: `
    <h1>Platform connections<em>.</em></h1>
    <p class="sub">Connect the job platforms <b>your company</b> uses. Once connected, posting a role auto-publishes to that board <b>through your account</b>. CALIBR's own board, Google for Jobs and the XML feed are always on — no connection needed.</p>
    <div class="msg">Real auto-posting to LinkedIn / Indeed / Pnet / Careers24 / Job Mail runs on each platform's partner API, which requires a paid recruiter account on that platform. CALIBR stores your account credential and posts on your behalf; it never posts from a CALIBR-owned account.</div>
    <div class="grid">${rows}</div>
    <a class="btn g" href="/company">Back to dashboard</a>` }));
});
app.post('/company/connections/:platform', requireAuth, requireRole('employer'), (req, res) => {
  const p = distribute.platform(req.params.platform);
  if (!p || p.kind !== 'partner') return res.redirect('/company/connections');
  const label = (req.body.account_label || '').slice(0, 160), secret = (req.body.secret || '').slice(0, 400);
  const ex = db.get('SELECT id FROM connections WHERE company_id=? AND platform=?', req.user.company_id, p.key);
  if (ex) db.run('UPDATE connections SET status=?, account_label=?, secret=? WHERE id=?', 'connected', label, secret || null, ex.id);
  else db.run('INSERT INTO connections (company_id,platform,status,account_label,secret,created_at) VALUES (?,?,?,?,?,?)', req.user.company_id, p.key, 'connected', label, secret || null, now());
  res.redirect('/company/connections');
});
app.post('/company/connections/:platform/disconnect', requireAuth, requireRole('employer'), (req, res) => {
  db.run('DELETE FROM connections WHERE company_id=? AND platform=?', req.user.company_id, req.params.platform);
  res.redirect('/company/connections');
});

// Real OAuth 2.0 handshake — only active when CALIBR has the platform's app credentials in .env.
app.get('/company/connections/:platform/oauth/start', requireAuth, requireRole('employer'), (req, res) => {
  const platform = req.params.platform;
  if (!oauth.ready(platform)) return res.redirect('/company/connections');
  const state = crypto.randomBytes(12).toString('hex');
  req.session.oauth = { state, platform, company_id: req.user.company_id };
  res.redirect(oauth.authorizeUrl(platform, absUrl(req, '/oauth/callback'), state));
});
app.get('/oauth/callback', requireAuth, requireRole('employer'), async (req, res) => {
  const s = req.session.oauth;
  const back = '/company/connections';
  if (!s || !req.query.state || req.query.state !== s.state) return res.status(400).send(shell({ title: 'Connection failed', user: req.user, body: '<h1>Connection failed<em>.</em></h1><p class="sub">Security check failed (state mismatch). Please try connecting again.</p><a class="btn g" href="/company/connections">Back</a>' }));
  if (req.query.error) { req.session.oauth = null; return res.redirect(back); }
  try {
    const tok = await oauth.exchange(s.platform, req.query.code, absUrl(req, '/oauth/callback'));
    const label = tok.account || oauth.provider(s.platform).name + ' account';
    const secret = tok.access_token + (tok.refresh_token ? '||' + tok.refresh_token : '');
    const ex = db.get('SELECT id FROM connections WHERE company_id=? AND platform=?', s.company_id, s.platform);
    if (ex) db.run('UPDATE connections SET status=?, account_label=?, secret=? WHERE id=?', 'connected', label, secret, ex.id);
    else db.run('INSERT INTO connections (company_id,platform,status,account_label,secret,created_at) VALUES (?,?,?,?,?,?)', s.company_id, s.platform, 'connected', label, secret, now());
    req.session.oauth = null;
    res.redirect(back);
  } catch (e) {
    req.session.oauth = null;
    res.status(502).send(shell({ title: 'Connection failed', user: req.user, body: `<h1>Connection failed<em>.</em></h1><p class="sub">${esc(e.message)}</p><a class="btn g" href="/company/connections">Back</a>` }));
  }
});

// ---------- BULK CV UPLOAD → JD-scored, added to pipeline ----------
app.get('/company/role/:id/bulk', requireAuth, requireRole('employer'), (req, res) => {
  const role = db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!role) return res.redirect('/company');
  res.send(shell({ title: 'Bulk screen: ' + role.title, user: req.user, body: `
    <h1>Bulk CV screen · ${esc(role.title)}<em>.</em></h1>
    <p class="sub"><a href="/company/role/${role.id}" style="color:var(--pink);font-weight:700">&larr; Screen</a> · Paste multiple CVs, each separated by a line with just <b>---</b>. Every CV is scored against this job and added to the pipeline, ranked by JD match.</p>
    ${roleKeywords(role).length ? '' : '<div class="msg">This role has no extracted keywords yet — <a href="/company/role/' + role.id + '/distribute" style="color:var(--pink);font-weight:700">add a description</a> first for accurate scoring.</div>'}
    <form method="post" action="/company/role/${role.id}/bulk">
      <div class="fld"><label>Paste CVs (separate each with a line of ---)</label><textarea name="blob" required style="min-height:320px" placeholder="First candidate's CV text...&#10;---&#10;Second candidate's CV text...&#10;---&#10;Third candidate's CV text..."></textarea></div>
      <button class="btn">Score &amp; add to pipeline</button>
    </form>` }));
});
app.post('/company/role/:id/bulk', requireAuth, requireRole('employer'), async (req, res) => {
  const role = db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!role) return res.redirect('/company');
  let kws = roleKeywords(role);
  if (!kws.length && role.description) { try { const p = await reindexRole(role); kws = p ? p.keywords : []; } catch (e) {} }
  const chunks = (req.body.blob || '').split(/\n\s*-{3,}\s*\n/).map(s => s.trim()).filter(s => s.length > 40).slice(0, 50);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const cv = chunks[i].slice(0, 9000);
    const emailMatch = cv.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const email = (emailMatch ? emailMatch[0] : 'bulk+' + crypto.randomBytes(5).toString('hex') + '@calibr.local').toLowerCase();
    const nameGuess = (cv.split('\n')[0] || '').trim().slice(0, 80) || ('Candidate ' + (i + 1));
    let u = db.get('SELECT * FROM users WHERE email=?', email);
    if (!u) { const hash = bcrypt.hashSync(crypto.randomBytes(9).toString('hex'), 10); const ins = db.run('INSERT INTO users (role,name,email,pass,cv,created_at) VALUES (?,?,?,?,?,?)', 'seeker', nameGuess, email, hash, cv, now()); u = { id: Number(ins.lastInsertRowid), name: nameGuess }; }
    else db.run('UPDATE users SET cv=? WHERE id=?', cv, u.id);
    const scored = await ats.scoreCV(cv, kws, role.description || role.title);
    const report = JSON.stringify({ matched: scored.matched, missing: scored.missing, flags: scored.flags, summary: scored.summary || '', engine: scored.engine });
    const ex = db.get('SELECT id FROM applications WHERE role_id=? AND user_id=?', role.id, u.id);
    if (ex) db.run('UPDATE applications SET jd_match=?, jd_report=?, cv_text=?, fit=?, source=? WHERE id=?', scored.match, report, cv, scored.match, 'bulk', ex.id);
    else db.run('INSERT INTO applications (role_id,user_id,stage,fit,jd_match,jd_report,cv_text,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)', role.id, u.id, 'New', scored.match, scored.match, report, cv, 'bulk', now());
    results.push({ name: u.name, match: scored.match });
  }
  results.sort((a, b) => b.match - a.match);
  res.send(shell({ title: 'Bulk screen result', user: req.user, body: `
    <h1>Screened ${results.length} CV${results.length === 1 ? '' : 's'}<em>.</em></h1>
    <p class="sub">All added to the pipeline for <b>${esc(role.title)}</b>, ranked by JD match. <a href="/company/role/${role.id}/pipeline" style="color:var(--pink);font-weight:700">Open pipeline &rarr;</a></p>
    <div class="table-wrap"><table><tr><th>#</th><th>Candidate</th><th>JD match</th></tr>${results.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td><b style="color:var(--pink)">${r.match}%</b></td></tr>`).join('') || '<tr><td colspan="3">No CVs detected — separate each with a line of ---.</td></tr>'}</table></div>` }));
});

// Screen the pre-scored pool against a role (weighted fit)
app.get('/company/role/:id', requireAuth, requireRole('employer'), (req, res) => {
  const role = db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!role) return res.redirect('/company');
  const pool = db.all(`SELECT u.id uid, u.name, s.composite, s.axes, s.token FROM scores s JOIN users u ON u.id=s.user_id
    WHERE s.id IN (SELECT MAX(id) FROM scores GROUP BY user_id)`);
  const inPipe = new Set(db.all('SELECT user_id FROM applications WHERE role_id=?', role.id).map(a => a.user_id));
  const profile = companyProfile(req.user.company_id); const rawMap = cultureRawMap(); const cw = cultureWeightsOf(req.user.company_id);
  const ranked = pool.map(p => { const ax = axesWithCulture(p.axes, p.uid, profile, rawMap, cw); return { ...p, ax, fit: fitFor(JSON.stringify(ax), role.weights), cf: ax['Culture-Fit'] }; }).sort((a, b) => b.fit - a.fit);
  const w = JSON.parse(role.weights || '{}');
  res.send(shell({ title: 'Screen: ' + role.title, user: req.user, body: `
    <h1>Screen · ${esc(role.title)}<em>.</em></h1>
    <p class="sub">${role.salary ? 'R' + Number(role.salary).toLocaleString('en-US') + '/yr · ' : ''}Every scored candidate ranked by fit to this role. <a href="/company/role/${role.id}/pipeline" style="color:var(--pink);font-weight:700">View pipeline &rarr;</a></p>
    <div class="actions"><a class="btn sm" href="/company/role/${role.id}/bulk">Bulk CV upload</a> <a class="btn sm g" href="/company/role/${role.id}/distribute">Distribute</a> <a class="btn sm g" href="/company/role/${role.id}/scorecard">Scorecard</a></div>
    <div class="lbl">Rubric weights (per axis)</div>
    <form method="post" action="/company/role/${role.id}/weights" class="fld inline">
      ${AXES.map(k => `<div><label style="font-size:10px">${esc(k)}</label><input type="number" name="w_${esc(k)}" value="${w[k] != null ? w[k] : 20}" min="0" max="100"></div>`).join('')}
      <div style="display:flex;align-items:flex-end"><button class="btn sm">Re-rank</button></div>
    </form>
    ${profile ? '' : '<div class="msg">Tip: <a href="/company/culture" style="color:var(--pink);font-weight:700">set your culture profile</a> so Culture-Fit scores candidates against your company.</div>'}
    <div class="lbl">Ranked candidates (${ranked.length})</div>
    <div class="table-wrap"><table><tr><th>Candidate</th><th>Fit</th><th>Overall</th><th>Culture-Fit${profile ? ' · vs you' : ''}</th><th>Top axis</th><th></th></tr>
    ${ranked.map(p => { const top = Object.entries(p.ax).sort((a, b) => b[1] - a[1])[0];
      return `<tr><td><b>${esc(p.name)}</b></td><td><b style="color:var(--pink);font-size:17px">${p.fit}</b></td><td>${p.composite}</td><td>${p.cf != null ? p.cf : '—'}</td><td>${esc(top[0])} (${top[1]})</td>
      <td>${inPipe.has(p.uid) ? '<span class="pill done">In pipeline</span>' : `<form method="post" action="/company/role/${role.id}/add" style="display:inline"><input type="hidden" name="uid" value="${p.uid}"><button class="btn sm">Add to pipeline</button></form>`}</td></tr>`; }).join('') || '<tr><td colspan="6">No scored candidates yet.</td></tr>'}
    </table></div>` }));
});

app.post('/company/role/:id/weights', requireAuth, requireRole('employer'), (req, res) => {
  const role = db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (role) { const w = Object.fromEntries(AXES.map(k => [k, Math.max(0, parseInt(req.body['w_' + k], 10) || 0)])); db.run('UPDATE roles_posted SET weights=? WHERE id=?', JSON.stringify(w), role.id); }
  res.redirect('/company/role/' + req.params.id);
});

app.post('/company/role/:id/add', requireAuth, requireRole('employer'), (req, res) => {
  const role = db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  const sc = db.get('SELECT axes FROM scores WHERE user_id=? ORDER BY id DESC LIMIT 1', req.body.uid);
  if (role && sc) {
    const ax = axesWithCulture(sc.axes, Number(req.body.uid), companyProfile(req.user.company_id), cultureRawMap(), cultureWeightsOf(req.user.company_id));
    try { db.run('INSERT INTO applications (role_id,user_id,stage,fit,created_at) VALUES (?,?,?,?,?)', role.id, req.body.uid, 'New', fitFor(JSON.stringify(ax), role.weights), now()); } catch (e) {}
  }
  res.redirect('/company/role/' + req.params.id + '/pipeline');
});

// Pipeline
app.get('/company/role/:id/pipeline', requireAuth, requireRole('employer'), (req, res) => {
  const role = db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!role) return res.redirect('/company');
  const apps = db.all('SELECT a.*, u.name FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN users u ON u.id=a.user_id WHERE a.role_id=? ORDER BY a.fit DESC', role.id);
  const rows = apps.map(a => `<tr><td><b>${esc(a.name)}</b>${a.source === 'public' ? ' <span class="pill todo">applied</span>' : ''}</td><td><b style="color:var(--pink)">${a.fit}</b></td><td>${a.jd_match != null ? a.jd_match + '%' : '—'}</td><td>${esc(a.stage)}</td>
    <td><form method="post" action="/company/app/${a.id}/stage" style="display:flex;gap:6px">
      <select name="stage">${STAGES.map(s => `<option${s === a.stage ? ' selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn sm">Move</button></form></td><td><a class="btn sm g" href="/company/app/${a.id}">View</a></td></tr>`).join('');
  res.send(shell({ title: 'Pipeline: ' + role.title, user: req.user, body: `
    <h1>Pipeline · ${esc(role.title)}<em>.</em></h1>
    <p class="sub"><a href="/company/role/${role.id}" style="color:var(--pink);font-weight:700">&larr; Back to screening</a> · move candidates through stages. Mark <b>Hired</b> when you make an offer.</p>
    <div class="stagebar">${STAGES.map(s => `<span class="pill ${s === 'Hired' ? 'done' : 'todo'}">${s}: ${apps.filter(a => a.stage === s).length}</span>`).join('')}</div>
    ${apps.length ? `<div class="table-wrap"><table><tr><th>Candidate</th><th>Fit</th><th>JD match</th><th>Stage</th><th>Move</th><th></th></tr>${rows}</table></div>` : '<p class="sub">No candidates yet — add them from the screen page, or share the public apply link.</p>'}` }));
});

// Applicant detail — parsed JD match report + CV
app.get('/company/app/:id', requireAuth, requireRole('employer'), (req, res) => {
  const a = db.get(`SELECT a.*, u.name, u.email, r.title, r.company_id FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN users u ON u.id=a.user_id WHERE a.id=?`, req.params.id);
  if (!a || a.company_id !== req.user.company_id) return res.redirect('/company');
  let rep = {}; try { rep = JSON.parse(a.jd_report || '{}'); } catch (e) {}
  const chips = (arr, cls) => (arr && arr.length) ? arr.map(k => `<span class="chip ${cls}">${esc(k)}</span>`).join('') : '<span class="sub">none</span>';
  const sc = db.get('SELECT composite, token FROM scores WHERE user_id=? ORDER BY id DESC LIMIT 1', a.user_id);
  const cRaw = db.get("SELECT raw FROM assessments WHERE user_id=? AND type='culture' AND status='done'", a.user_id);
  const cb = cultureBreakdown(cRaw && cRaw.raw, companyProfile(a.company_id), cultureWeightsOf(a.company_id));
  const cultureHtml = cb ? `
    <div class="lbl">Culture-Fit · why <span style="color:var(--pink)">${cb.score != null ? cb.score : '—'}</span></div>
    <div class="table-wrap"><table><tr><th>Dimension</th><th>Your ideal</th><th>Candidate</th><th>Fit</th><th>Weight</th><th>Read</th></tr>
    ${cb.dims.map(d => `<tr><td><b>${esc(d.label)}</b></td><td>${esc(String(d.ideal))}</td><td>${esc(String(d.cand))}</td><td><b style="color:${d.fit >= 80 ? 'var(--pink)' : d.fit >= 50 ? 'var(--ink)' : '#c33'}">${d.fit}%</b></td><td>${esc(IMPORTANCE[d.weight] != null ? IMPORTANCE[d.weight] : String(d.weight))}</td><td>${esc(d.note)}</td></tr>`).join('')}
    </table></div>`
    : (companyProfile(a.company_id) ? '<div class="msg">This candidate hasn\'t completed the culture assessment yet.</div>' : '<div class="msg">Set your <a href="/company/culture" style="color:var(--pink);font-weight:700">culture profile</a> to see the culture-fit breakdown.</div>');
  res.send(shell({ title: a.name, user: req.user, body: `
    <h1>${esc(a.name)}<em>.</em></h1>
    <p class="sub"><a href="/company/role/${a.role_id}/pipeline" style="color:var(--pink);font-weight:700">&larr; Pipeline</a> · ${esc(a.title)} · ${esc(a.email)}${sc ? ` · <a href="/verify/${sc.token}" style="color:var(--pink);font-weight:700">CALIBR Score ${sc.composite}</a>` : ' · no CALIBR Score yet'}</p>
    <div class="ats-grid">${matchBar(a.jd_match != null ? a.jd_match : 0)}<div class="ats-delta"><div class="ats-num" style="color:var(--pink)">${a.fit}<span></span></div><div class="l">Blended fit${sc ? ' (JD + CALIBR)' : ''}</div></div></div>
    <div class="actions"><a class="btn sm g" href="/company/app/${a.id}/summary">✦ AI CV summary</a> <a class="btn sm g" href="/company/app/${a.id}/questions">✦ Interview kit</a></div>
    ${rep.summary ? `<div class="msg">${esc(rep.summary)}${rep.seniority_fit ? ' · seniority: ' + esc(rep.seniority_fit) : ''}</div>` : ''}
    <div class="lbl">Matched the job on</div><div class="chips">${chips(rep.matched, 'ok')}</div>
    <div class="lbl">Missing vs the job</div><div class="chips">${chips(rep.missing, 'miss')}</div>
    ${rep.flags && rep.flags.length ? `<div class="lbl">CV parse-safety</div><ul class="flags">${rep.flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${cultureHtml}
    ${hiring ? hiring.applicantExtras(a.id, a.role_id) : ''}
    ${collab ? collab.commentsHtml(a.id) : ''}
    <div class="lbl">CV as applied</div><div class="q" style="white-space:pre-wrap;font-size:13px;line-height:1.6">${esc(a.cv_text || 'No CV text stored.')}</div>` }));
});

app.post('/company/app/:id/stage', requireAuth, requireRole('employer'), (req, res) => {
  const a = db.get('SELECT a.*, r.company_id, r.salary, r.title, u.name uname, u.phone uphone FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN users u ON u.id=a.user_id WHERE a.id=?', req.params.id);
  if (!a || a.company_id !== req.user.company_id) return res.redirect('/company');
  const stage = STAGES.includes(req.body.stage) ? req.body.stage : a.stage;
  db.run('UPDATE applications SET stage=? WHERE id=?', stage, a.id);
  if (stage === 'Hired' && a.stage !== 'Hired') db.run('UPDATE applications SET hired_at=? WHERE id=? AND hired_at IS NULL', now(), a.id);
  if (stage !== a.stage && a.uphone && ['Shortlist', 'Interview', 'Offer', 'Hired'].includes(stage)) notify.fire(a.uphone, notify.T.stage(a.uname, a.title, stage));
  res.redirect('/company/role/' + a.role_id + '/pipeline');
});

// Culture profile — employer answers the culture questions as the ideal
const IMPORTANCE = ['Ignore', 'Low', 'Normal', 'High']; // weight 0..3
app.get('/company/culture', requireAuth, requireRole('employer'), (req, res) => {
  const profile = companyProfile(req.user.company_id) || [];
  const weights = cultureWeightsOf(req.user.company_id) || [];
  const qs = BANK.culture.q.map((q, i) => {
    const wv = weights[i] != null ? weights[i] : 2;
    return `<div class="q">
      <p><b>${esc(q.label)}</b> — ${esc(q.t)}</p>
      ${q.o.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}"${profile[i] === j ? ' checked' : ''} required> ${esc(o)}</label>`).join('')}
      <div class="fld" style="margin-top:10px;margin-bottom:0"><label style="font-size:10px">How much this matters when scoring fit</label>
        <select name="w${i}">${IMPORTANCE.map((lbl, k) => `<option value="${k}"${wv === k ? ' selected' : ''}>${lbl}</option>`).join('')}</select></div>
    </div>`;
  }).join('');
  res.send(shell({ title: 'Culture profile', user: req.user, body: `
    <h1>Your culture profile<em>.</em></h1>
    <p class="sub">Set the <b>ideal for your company</b> on each of the 7 dimensions, and how much each one matters. Candidates answer the same as themselves — Culture-Fit then scores how closely each candidate matches <b>you</b>, weighted by what you care about, per role.</p>
    <div class="msg" style="font-size:12px">There is no universally "right" culture answer — you define it. Use this as decision-support alongside the other axes; it should be validated for adverse impact before it gates a hire. <a href="/methodology" style="color:var(--pink);font-weight:700">See the research &rarr;</a></div>
    <form method="post" action="/company/culture">${qs}<button class="btn">Save culture profile</button> <a class="btn g" href="/company">Cancel</a></form>` }));
});
app.post('/company/culture', requireAuth, requireRole('employer'), (req, res) => {
  const arr = BANK.culture.q.map((q, i) => parseInt(req.body['q' + i], 10));
  const w = BANK.culture.q.map((q, i) => { const v = parseInt(req.body['w' + i], 10); return Number.isInteger(v) ? Math.max(0, Math.min(3, v)) : 2; });
  db.run('UPDATE companies SET culture=?, culture_w=? WHERE id=?', JSON.stringify(arr), JSON.stringify(w), req.user.company_id);
  res.redirect('/company');
});

// Reports — EE / B-BBEE hire breakdown
app.get('/company/reports', requireAuth, requireRole('employer'), (req, res) => {
  const hired = db.all(`SELECT u.ee_race, u.ee_gender FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN users u ON u.id=a.user_id WHERE r.company_id=? AND a.stage='Hired'`, req.user.company_id);
  const byRace = {}, byGender = {};
  hired.forEach(h => { const r = h.ee_race || 'Not disclosed'; const g = h.ee_gender || 'Not disclosed'; byRace[r] = (byRace[r] || 0) + 1; byGender[g] = (byGender[g] || 0) + 1; });
  const tbl = (o) => Object.keys(o).length ? `<div class="table-wrap"><table><tr><th>Category</th><th>Hires</th></tr>${Object.entries(o).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table></div>` : '<p class="sub">No hires recorded yet.</p>';
  res.send(shell({ title: 'Reports', user: req.user, body: `
    <h1>Reports<em>.</em></h1><p class="sub">Employment-equity breakdown of your hires, from candidate self-ID.</p>
    <div class="price-strip"><div><div class="p">${hired.length}</div><div class="l">Hires via CALIBR</div></div></div>
    <div class="lbl">Hires by race (EE)</div>${tbl(byRace)}
    <div class="lbl">Hires by gender (EE)</div>${tbl(byGender)}
    <div class="actions"><a class="btn sm" href="/company/reports/ee.csv">Download EE report (CSV)</a></div>
    <p class="sub" style="font-size:12px">EE self-identification is optional and POPIA-protected. Candidates who did not disclose appear as "Not disclosed". The CSV gives a race × gender matrix of applicants and hires for your EEA2 / EEA4 workings.</p>` }));
});
// EE / B-BBEE workforce export (race × gender matrix of applicants & hires) — CSV
app.get('/company/reports/ee.csv', requireAuth, requireRole('employer'), (req, res) => {
  const rows = db.all(`SELECT u.ee_race, u.ee_gender, a.stage FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN users u ON u.id=a.user_id WHERE r.company_id=?`, req.user.company_id);
  const ADV = new Set(['Shortlist', 'Interview', 'Offer', 'Hired']);
  const g = {};
  rows.forEach(r => { const race = r.ee_race || 'Not disclosed', gender = r.ee_gender || 'Not disclosed'; const k = race + '||' + gender; (g[k] = g[k] || { race, gender, applicants: 0, advanced: 0, hired: 0 }); g[k].applicants++; if (ADV.has(r.stage)) g[k].advanced++; if (r.stage === 'Hired') g[k].hired++; });
  const q = s => /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
  const lines = ['Race,Gender,Applicants,Advanced,Hired'];
  Object.values(g).sort((a, b) => b.applicants - a.applicants).forEach(x => lines.push([x.race, x.gender, x.applicants, x.advanced, x.hired].map(q).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="calibr-ee-report.csv"');
  res.send(lines.join('\r\n'));
});

app.get('/company/pool', requireAuth, requireRole('employer'), (req, res) => {
  const pool = db.all(`SELECT u.name, s.composite, s.axes, s.token FROM scores s JOIN users u ON u.id=s.user_id
    WHERE s.id IN (SELECT MAX(id) FROM scores GROUP BY user_id) ORDER BY s.composite DESC`);
  res.send(shell({ title: 'Talent pool', user: req.user, body: `
    <h1>Talent pool<em>.</em></h1><p class="sub">Every candidate scored on the same axes — ranked, comparable, verified.</p>
    ${pool.length ? `<table><tr><th>Candidate</th><th>CALIBR Score</th><th>Top axis</th><th></th></tr>
    ${pool.map(p => { const ax = JSON.parse(p.axes); const top = Object.entries(ax).sort((a, b) => b[1] - a[1])[0];
      return `<tr><td><b>${esc(p.name)}</b></td><td><b style="color:var(--pink);font-size:18px">${p.composite}</b></td><td>${esc(top[0])} (${top[1]})</td><td><a class="btn sm g" href="/verify/${p.token}">View score</a></td></tr>`; }).join('')}
    </table>` : '<p class="sub">No scored candidates yet.</p>'}` }));
});

// ---------- WELLNESS (non-clinical) ----------
const CRISIS = [
  ['SADAG Mental Health Line', '0800 567 567', 'or SMS 31393 · 24/7'],
  ['SADAG Suicide Crisis Line', '0800 567 567', '24/7'],
  ['Lifeline South Africa', '0861 322 322', '24/7'],
  ['Emergency', '112 / 10111', 'immediate danger'],
];
app.get('/app/wellness', requireAuth, requireRole('seeker'), (req, res) => {
  const hist = db.all('SELECT * FROM wellness_checkins WHERE user_id=? ORDER BY id DESC LIMIT 10', req.user.id);
  const avg = hist.length ? Math.round(hist.reduce((t, h) => t + (h.mood || 0), 0) / hist.length * 10) / 10 : null;
  res.send(shell({ title: 'Wellness', user: req.user, body: `
    <h1>Wellness<em>.</em></h1>
    <div class="msg" style="border-left-color:#c33"><b>Not a clinical or medical service.</b> CALIBR Wellness is a light self-check to support you during your job search — it is not counselling, diagnosis or treatment. If you are struggling or in crisis, please reach out to a professional now:</div>
    <div class="table-wrap"><table><tr><th>Line</th><th>Number</th><th></th></tr>${CRISIS.map(c => `<tr><td><b>${esc(c[0])}</b></td><td><b style="color:var(--pink)">${esc(c[1])}</b></td><td>${esc(c[2])}</td></tr>`).join('')}</table></div>
    <div class="lbl">Quick check-in</div>
    <form method="post" action="/app/wellness">
      <div class="fld inline">
        <div style="flex:1"><label>Mood today (1 low – 5 great)</label><select name="mood">${[3,1,2,4,5].map(n => `<option value="${n}">${n}</option>`).join('')}</select></div>
        <div style="flex:1"><label>Stress (1 calm – 5 overwhelmed)</label><select name="stress">${[3,1,2,4,5].map(n => `<option value="${n}">${n}</option>`).join('')}</select></div>
      </div>
      <div class="fld"><label>Anything on your mind? (optional, private to you)</label><textarea name="note" style="min-height:90px"></textarea></div>
      <button class="btn">Save check-in</button>
    </form>
    ${avg != null ? `<div class="lbl">Your recent mood average: ${avg}/5</div>` : ''}
    ${hist.length ? `<div class="table-wrap"><table><tr><th>Date</th><th>Mood</th><th>Stress</th><th>Note</th></tr>${hist.map(h => `<tr><td>${esc((h.created_at || '').slice(0, 10))}</td><td>${h.mood || '—'}</td><td>${h.stress || '—'}</td><td>${esc((h.note || '').slice(0, 80))}</td></tr>`).join('')}</table></div>` : ''}
    <div class="lbl">Looking after yourself while job-hunting</div>
    <ul class="flags">
      <li>Job searching is hard and rejection isn't a measure of your worth — pace yourself.</li>
      <li>Set a small daily goal (e.g. 2 quality applications) instead of endless scrolling.</li>
      <li>Keep a routine: sleep, movement and one thing that isn't about the search.</li>
      <li>Talk to someone you trust; reach out to the lines above if it gets heavy.</li>
    </ul>` }));
});
app.post('/app/wellness', requireAuth, requireRole('seeker'), (req, res) => {
  const m = Math.min(5, Math.max(1, parseInt(req.body.mood, 10) || 3));
  const s = Math.min(5, Math.max(1, parseInt(req.body.stress, 10) || 3));
  db.run('INSERT INTO wellness_checkins (user_id,mood,stress,note,created_at) VALUES (?,?,?,?,?)', req.user.id, m, s, (req.body.note || '').slice(0, 1000) || null, now());
  res.redirect('/app/wellness');
});

// ---------- BILLING (Paystack) ----------
function planLabel(u) { return u.plan ? paystack.PLANS[u.plan] ? paystack.PLANS[u.plan].name : u.plan : null; }
app.get('/app/billing', requireAuth, requireRole('seeker'), (req, res) => {
  const cur = planLabel(req.user);
  const cards = Object.entries(paystack.PLANS).map(([key, p]) => `<div class="card"><h3>${esc(p.name)}<em>.</em></h3><div class="score-num" style="font-size:36px">R${p.amount}<span style="font-size:14px">/mo</span></div><p>${esc(p.blurb)}</p>${req.user.plan === key ? '<span class="pill done">Current plan</span>' : `<form method="post" action="/app/billing/subscribe/${key}"><button class="btn sm block"${paystack.hasKeys() ? '' : ' disabled'}>Choose ${esc(p.name)}</button></form>`}</div>`).join('');
  res.send(shell({ title: 'Billing', user: req.user, body: `
    <h1>Billing<em>.</em></h1><p class="sub">${cur ? 'Current plan: <b>' + esc(cur) + '</b>. ' : ''}Priced in Rand, cancel anytime.</p>
    ${paystack.hasKeys() ? '' : '<div class="msg">Payments aren\'t switched on yet. Add <b>PAYSTACK_SECRET_KEY</b> and <b>PAYSTACK_PUBLIC_KEY</b> to <b>app/.env</b> to enable checkout.</div>'}
    <div class="grid">${cards}</div>` }));
});
app.post('/app/billing/subscribe/:plan', requireAuth, requireRole('seeker'), async (req, res) => {
  const plan = paystack.PLANS[req.params.plan]; if (!plan) return res.redirect('/app/billing');
  if (!paystack.hasKeys()) return res.redirect('/app/billing');
  const reference = paystack.ref('sub');
  db.run('INSERT INTO payments (user_id,kind,plan,amount,reference,status,created_at) VALUES (?,?,?,?,?,?,?)', req.user.id, 'subscription', req.params.plan, plan.amount, reference, 'pending', now());
  try {
    const t = await paystack.initTransaction({ email: req.user.email, amount: plan.amount, reference, callback_url: absUrl(req, '/billing/callback'), metadata: { user_id: req.user.id, plan: req.params.plan, kind: 'subscription' } });
    res.redirect(t.authorization_url);
  } catch (e) { res.send(shell({ title: 'Billing', user: req.user, body: `<h1>Checkout failed<em>.</em></h1><p class="sub">${esc(e.message)}</p><a class="btn g" href="/app/billing">Back</a>` })); }
});
app.get('/company/billing', requireAuth, requireRole('employer'), (req, res) => {
  const co = db.get('SELECT plan FROM companies WHERE id=?', req.user.company_id) || {};
  const curKey = co.plan || null;
  const cur = curKey && paystack.EMPLOYER_PLANS[curKey] ? paystack.EMPLOYER_PLANS[curKey].name : null;
  const cards = Object.entries(paystack.EMPLOYER_PLANS).map(([key, p]) => {
    const price = p.custom ? 'Custom' : 'R' + p.amount.toLocaleString('en-US') + '<span style="font-size:14px">/mo</span>';
    const action = p.custom
      ? '<a class="btn sm block g" href="https://calibr-careers.tech/pricing.html" target="_blank">Talk to us</a>'
      : (curKey === key ? '<span class="pill done">Current plan</span>' : `<form method="post" action="/company/billing/subscribe/${key}"><button class="btn sm block"${paystack.hasKeys() ? '' : ' disabled'}>Choose ${esc(p.name)}</button></form>`);
    return `<div class="card"><h3>${esc(p.name)}<em>.</em></h3><div class="score-num" style="font-size:34px">${price}</div><p>${esc(p.blurb)}</p>${action}</div>`;
  }).join('');
  res.send(shell({ title: 'Billing', user: req.user, body: `
    <h1>Billing<em>.</em></h1><p class="sub">${cur ? 'Current plan: <b>' + esc(cur) + '</b>. ' : ''}One flat monthly subscription in Rand — unlimited candidate screening, no success fees, cancel anytime.</p>
    ${paystack.hasKeys() ? '' : '<div class="msg">Add <b>PAYSTACK_SECRET_KEY</b> / <b>PAYSTACK_PUBLIC_KEY</b> to <b>app/.env</b> to enable checkout.</div>'}
    <div class="grid">${cards}</div>` }));
});
app.post('/company/billing/subscribe/:plan', requireAuth, requireRole('employer'), async (req, res) => {
  const plan = paystack.EMPLOYER_PLANS[req.params.plan];
  if (!plan || plan.custom) return res.redirect('/company/billing');
  if (!paystack.hasKeys()) return res.redirect('/company/billing');
  const reference = paystack.ref('cosub');
  db.run('INSERT INTO payments (company_id,kind,plan,amount,reference,status,created_at) VALUES (?,?,?,?,?,?,?)', req.user.company_id, 'subscription', req.params.plan, plan.amount, reference, 'pending', now());
  try {
    const t = await paystack.initTransaction({ email: req.user.email, amount: plan.amount, reference, callback_url: absUrl(req, '/billing/callback'), metadata: { company_id: req.user.company_id, plan: req.params.plan, kind: 'subscription' } });
    res.redirect(t.authorization_url);
  } catch (e) { res.send(shell({ title: 'Billing', user: req.user, body: `<h1>Checkout failed<em>.</em></h1><p class="sub">${esc(e.message)}</p><a class="btn g" href="/company/billing">Back</a>` })); }
});
// Shared callback after Paystack checkout
app.get('/billing/callback', requireAuth, async (req, res) => {
  const reference = req.query.reference || req.query.trxref;
  const back = req.user.role === 'employer' ? '/company/billing' : '/app/billing';
  if (!reference) return res.redirect(back);
  try {
    const d = await paystack.verify(reference);
    if (d.status === 'success') applyPayment(reference);
  } catch (e) { /* webhook will reconcile */ }
  res.redirect(back);
});
// Mark a payment paid and apply its effect (idempotent).
function applyPayment(reference) {
  const p = db.get('SELECT * FROM payments WHERE reference=?', reference);
  if (!p || p.status === 'paid') return;
  db.run('UPDATE payments SET status=? WHERE id=?', 'paid', p.id);
  if (p.kind === 'subscription' && p.user_id) db.run('UPDATE users SET plan=?, plan_since=? WHERE id=?', p.plan, now(), p.user_id);
  if (p.kind === 'subscription' && p.company_id) db.run('UPDATE companies SET plan=? WHERE id=?', p.plan, p.company_id);
  if (p.kind === 'success_fee' && p.company_id) db.run('UPDATE fee_events SET status=? WHERE company_id=? AND status=?', 'paid', p.company_id, 'owing');
}
// Paystack webhook (raw body for signature verification)
app.post('/paystack/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-paystack-signature'];
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : '';
  if (!paystack.validSignature(raw, sig)) return res.status(401).end();
  let ev; try { ev = JSON.parse(raw); } catch (e) { return res.status(400).end(); }
  if (ev.event === 'charge.success' && ev.data && ev.data.reference) applyPayment(ev.data.reference);
  res.status(200).end();
});

// ---------- PARTNER PORTAL ----------
const PARTNER_SHARE = 0.30; // partner keeps 30% of the referred employer's subscription (recurring)
function partnerStats(partnerId) {
  const cos = db.all('SELECT id, name, created_at, plan FROM companies WHERE referred_by=? ORDER BY id DESC', partnerId);
  const ids = cos.map(c => c.id);
  let subPaid = 0, subPending = 0;
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const pays = db.all(`SELECT amount, status FROM payments WHERE kind='subscription' AND company_id IN (${ph})`, ...ids);
    pays.forEach(p => { if (p.status === 'paid') subPaid += p.amount; else subPending += p.amount; });
  }
  return { cos, active: cos.filter(c => c.plan).length, commissionEarned: Math.round(subPaid * PARTNER_SHARE), commissionPending: Math.round(subPending * PARTNER_SHARE) };
}
app.get('/partner', requireAuth, requireRole('partner'), (req, res) => {
  if (!req.user.referral_code) { const code = 'P' + crypto.randomBytes(4).toString('hex').toUpperCase(); db.run('UPDATE users SET referral_code=? WHERE id=?', code, req.user.id); req.user.referral_code = code; }
  const s = partnerStats(req.user.id);
  const link = absUrl(req, '/signup?role=employer&ref=' + req.user.referral_code);
  res.send(shell({ title: 'Partner', user: req.user, body: `
    <h1>Partner dashboard<em>.</em></h1><p class="sub">Refer employers to CALIBR and earn <b>${Math.round(PARTNER_SHARE * 100)}%</b> of their monthly subscription, recurring for the life of the customer.</p>
    <div class="grid">
      <div class="card"><h3>Referred companies</h3><div class="score-num" style="font-size:40px">${s.cos.length}</div></div>
      <div class="card"><h3>Active subscriptions</h3><div class="score-num" style="font-size:40px">${s.active}</div></div>
      <div class="card"><h3>Commission earned</h3><div class="score-num" style="font-size:40px">R${s.commissionEarned.toLocaleString('en-US')}</div><p>from paid subscriptions</p></div>
      <div class="card"><h3>Pending commission</h3><div class="score-num" style="font-size:40px">R${s.commissionPending.toLocaleString('en-US')}</div><p>as invoices clear</p></div>
    </div>
    <div class="lbl">Your referral link</div>
    <div class="q"><b>${esc(link)}</b><p class="sub" style="margin-top:6px">Code: <b>${esc(req.user.referral_code)}</b> · share this; any employer who signs up through it is attributed to you.</p></div>
    <div class="actions"><a class="btn sm" href="/partner/referrals">Referrals</a> <a class="btn sm" href="/partner/materials">Co-branded materials</a> <a class="btn sm g" href="/partner/billing">Payouts</a></div>` }));
});
app.get('/partner/referrals', requireAuth, requireRole('partner'), (req, res) => {
  const s = partnerStats(req.user.id);
  res.send(shell({ title: 'Referrals', user: req.user, body: `
    <h1>Referrals<em>.</em></h1><p class="sub"><a href="/partner" style="color:var(--pink);font-weight:700">&larr; Dashboard</a></p>
    ${s.cos.length ? `<div class="table-wrap"><table><tr><th>Company</th><th>Signed up</th><th>Plan</th><th>Your commission earned</th></tr>${s.cos.map(c => { const paid = db.all("SELECT amount FROM payments WHERE kind='subscription' AND status='paid' AND company_id=?", c.id).reduce((t, p) => t + p.amount, 0); const planName = c.plan && paystack.EMPLOYER_PLANS[c.plan] ? paystack.EMPLOYER_PLANS[c.plan].name : '—'; return `<tr><td><b>${esc(c.name)}</b></td><td>${esc((c.created_at || '').slice(0, 10))}</td><td>${esc(planName)}</td><td>R${Math.round(paid * PARTNER_SHARE).toLocaleString('en-US')}</td></tr>`; }).join('')}</table></div>` : '<p class="sub">No referrals yet — share your link from the dashboard.</p>'}` }));
});
app.get('/partner/materials', requireAuth, requireRole('partner'), (req, res) => {
  res.send(shell({ title: 'Materials', user: req.user, body: `
    <h1>Co-branded materials<em>.</em></h1><p class="sub"><a href="/partner" style="color:var(--pink);font-weight:700">&larr; Dashboard</a></p>
    <div class="msg">Use these when introducing CALIBR to your clients. Your referral link is embedded — sign-ups are attributed to you automatically.</div>
    <div class="grid">
      <div class="card"><h3>One-pager</h3><p>CALIBR overview for employers</p><a class="btn sm g" href="https://calibr-careers.tech" target="_blank">View site</a></div>
      <div class="card"><h3>Pricing</h3><p>Flat monthly subscription plans</p><a class="btn sm g" href="https://calibr-careers.tech/pricing.html" target="_blank">Open</a></div>
      <div class="card"><h3>Your link</h3><p>Share to attribute sign-ups</p><a class="btn sm" href="/partner">Get link</a></div>
    </div>` }));
});
app.get('/partner/billing', requireAuth, requireRole('partner'), (req, res) => {
  const s = partnerStats(req.user.id);
  res.send(shell({ title: 'Payouts', user: req.user, body: `
    <h1>Payouts<em>.</em></h1><p class="sub"><a href="/partner" style="color:var(--pink);font-weight:700">&larr; Dashboard</a> · Commission is ${Math.round(PARTNER_SHARE * 100)}% of the monthly subscription from your referred clients, recurring while they stay.</p>
    <div class="price-strip"><div><div class="p">R${s.commissionEarned.toLocaleString('en-US')}</div><div class="l">Earned (client-settled)</div></div><div><div class="p">R${s.commissionPending.toLocaleString('en-US')}</div><div class="l">Pending</div></div></div>
    <p class="sub" style="font-size:12px">Payouts are settled by CALIBR to your nominated account. Add banking details during partner onboarding.</p>` }));
});

// ---------- ADMIN ----------
app.get('/admin', requireAuth, requireRole('admin'), (req, res) => {
  const c = db.get('SELECT (SELECT COUNT(*) FROM users) u,(SELECT COUNT(*) FROM companies) co,(SELECT COUNT(*) FROM scores) s,(SELECT COUNT(*) FROM assessments) a,(SELECT COUNT(*) FROM applications) ap,(SELECT COUNT(*) FROM roles_posted) r');
  const byRole = db.all('SELECT role, COUNT(*) n FROM users GROUP BY role');
  const subPaid = db.get("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE kind='subscription' AND status='paid'").t;
  const subPending = db.get("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE kind='subscription' AND status='pending'").t;
  const pays = db.all('SELECT * FROM payments ORDER BY id DESC LIMIT 12');
  res.send(shell({ title: 'Admin', user: req.user, body: `<h1>Admin<em>.</em></h1>
    <div class="grid">
      <div class="card"><h3>${c.u}</h3><p>Users (${byRole.map(r => r.n + ' ' + r.role).join(', ')})</p></div>
      <div class="card"><h3>${c.co}</h3><p>Companies</p></div>
      <div class="card"><h3>${c.r}</h3><p>Roles posted</p></div>
      <div class="card"><h3>${c.ap}</h3><p>Applications</p></div>
      <div class="card"><h3>${c.s}</h3><p>Scores issued</p></div>
      <div class="card"><h3>${c.a}</h3><p>Assessments</p></div>
    </div>
    <div class="lbl">Revenue (subscriptions)</div>
    <div class="price-strip"><div><div class="p">R${Number(subPaid).toLocaleString('en-US')}</div><div class="l">Collected</div></div><div><div class="p">R${Number(subPending).toLocaleString('en-US')}</div><div class="l">Pending</div></div></div>
    <div class="actions"><a class="btn sm" href="/admin/users">Users</a> <a class="btn sm" href="/admin/companies">Companies</a> <a class="btn sm" href="/admin/partners">Partners</a> <a class="btn sm g" href="/admin/payments">Payments</a></div>
    <div class="lbl">Recent payments</div>
    ${pays.length ? `<div class="table-wrap"><table><tr><th>Ref</th><th>Kind</th><th>Amount</th><th>Status</th><th>Date</th></tr>${pays.map(p => `<tr><td>${esc(p.reference)}</td><td>${esc(p.kind)}${p.plan ? ' · ' + esc(p.plan) : ''}</td><td>R${Number(p.amount).toLocaleString('en-US')}</td><td><span class="pill ${p.status === 'paid' ? 'done' : 'todo'}">${esc(p.status)}</span></td><td>${esc((p.created_at || '').slice(0, 10))}</td></tr>`).join('')}</table></div>` : '<p class="sub">No payments yet.</p>'}` }));
});
app.get('/admin/users', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.all('SELECT id, role, name, email, plan, created_at FROM users ORDER BY id DESC LIMIT 300');
  res.send(shell({ title: 'Admin · Users', user: req.user, body: `<h1>Users<em>.</em></h1><p class="sub"><a href="/admin" style="color:var(--pink);font-weight:700">&larr; Admin</a></p>
    <div class="table-wrap"><table><tr><th>ID</th><th>Role</th><th>Name</th><th>Email</th><th>Plan</th><th>Joined</th></tr>${rows.map(u => `<tr><td>${u.id}</td><td>${esc(u.role)}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.plan || '—')}</td><td>${esc((u.created_at || '').slice(0, 10))}</td></tr>`).join('')}</table></div>` }));
});
app.get('/admin/companies', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.all('SELECT c.*, (SELECT name FROM users WHERE id=c.referred_by) partner FROM companies c ORDER BY c.id DESC LIMIT 300');
  res.send(shell({ title: 'Admin · Companies', user: req.user, body: `<h1>Companies<em>.</em></h1><p class="sub"><a href="/admin" style="color:var(--pink);font-weight:700">&larr; Admin</a></p>
    <div class="table-wrap"><table><tr><th>ID</th><th>Company</th><th>Referred by</th><th>Created</th></tr>${rows.map(c => `<tr><td>${c.id}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.partner || '—')}</td><td>${esc((c.created_at || '').slice(0, 10))}</td></tr>`).join('')}</table></div>` }));
});
app.get('/admin/partners', requireAuth, requireRole('admin'), (req, res) => {
  const parts = db.all("SELECT * FROM users WHERE role='partner' ORDER BY id DESC");
  res.send(shell({ title: 'Admin · Partners', user: req.user, body: `<h1>Partners<em>.</em></h1><p class="sub"><a href="/admin" style="color:var(--pink);font-weight:700">&larr; Admin</a></p>
    ${parts.length ? `<div class="table-wrap"><table><tr><th>Partner</th><th>Code</th><th>Referred</th><th>Pending commission</th></tr>${parts.map(p => { const s = partnerStats(p.id); return `<tr><td><b>${esc(p.name)}</b><br><span class="sub">${esc(p.email)}</span></td><td>${esc(p.referral_code || '—')}</td><td>${s.cos.length}</td><td>R${s.commissionPending.toLocaleString('en-US')}</td></tr>`; }).join('')}</table></div>` : '<p class="sub">No partners yet.</p>'}` }));
});
app.get('/admin/payments', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.all('SELECT * FROM payments ORDER BY id DESC LIMIT 300');
  res.send(shell({ title: 'Admin · Payments', user: req.user, body: `<h1>Payments<em>.</em></h1><p class="sub"><a href="/admin" style="color:var(--pink);font-weight:700">&larr; Admin</a></p>
    ${rows.length ? `<div class="table-wrap"><table><tr><th>Ref</th><th>Kind</th><th>Amount</th><th>Status</th><th>Date</th></tr>${rows.map(p => `<tr><td>${esc(p.reference)}</td><td>${esc(p.kind)}${p.plan ? ' · ' + esc(p.plan) : ''}</td><td>R${Number(p.amount).toLocaleString('en-US')}</td><td><span class="pill ${p.status === 'paid' ? 'done' : 'todo'}">${esc(p.status)}</span></td><td>${esc((p.created_at || '').slice(0, 10))}</td></tr>`).join('')}</table></div>` : '<p class="sub">No payments yet.</p>'}` }));
});

const PORT = process.env.PORT || 4000;
hiring = require('./hiring')({ app, db, shell, esc, now, requireAuth, requireRole, STAGES, notify });
require('./intelligence')({ app, db, shell, esc, now, requireAuth, requireRole, ai: require('./ai') });
collab = require('./collab')({ app, db, shell, esc, now, requireAuth, requireRole });
webhooks = require('./publicapi')({ app, db, shell, esc, now, requireAuth, requireRole });
app.listen(PORT, () => console.log('CALIBR app running on http://localhost:' + PORT));
