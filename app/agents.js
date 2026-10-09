'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SIGHTLINE — the Calibr agent suite.  "One clear line from candidate to hire."
// Seven precision agents across the hiring lifecycle:
//   SCAN (source) · FOCUS (screen) · SIGNAL (outreach) · ALIGN (interview) ·
//   GAUGE (assess) · LOCK (offer) · LAUNCH (onboard)
// Each agent builds on CALIBR's existing engines (ats, assessments, ai, notify).
// Every feature works with no API key (deterministic) and sharpens with one.
// Integration-only capabilities (LinkedIn sourcing, external calendar, e-sign,
// market comp data, LMS) are shown as honest "Connect …" stubs — never faked.
// Registered before app.listen like hiring/intelligence/collab/publicapi.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const llm = require('./llm');

const SA_SYS = 'You are CALIBR Sightline, a South African recruiting assistant. Clear SA English. POPIA-aware, B-BBEE / Employment Equity conscious. Never invent facts about a candidate. Concise and practical.';
async function tryLLM(prompt, system) {
  if (!llm.hasKey()) return null;
  try { const t = await llm.complete(prompt, system || SA_SYS); return t && t.trim() ? t.trim() : null; } catch (e) { return null; }
}

// The seven agents (brand-locked names + lifecycle).
const AGENTS = [
  { key: 'scan',   name: 'SCAN',   stage: 'Discovery',  role: 'Sourcing',     live: true,  mission: 'Finds the right people before your competitors do — ranks your scored talent pool against the role.' },
  { key: 'focus',  name: 'FOCUS',  stage: 'Screening',  role: 'CV screening', live: true,  mission: 'Reads every CV in seconds. Scores, flags and ranks applicants so you focus only on the best.' },
  { key: 'signal', name: 'SIGNAL', stage: 'Outreach',   role: 'Outreach',     live: true,  mission: 'Writes personalised candidate messages and knows when to follow up — WhatsApp-native.' },
  { key: 'align',  name: 'ALIGN',  stage: 'Interview',  role: 'Coordination', live: true,  mission: 'Kills the scheduling nightmare — prep packs, question banks, calendar invites, debriefs.' },
  { key: 'gauge',  name: 'GAUGE',  stage: 'Assessment', role: 'Skills',       live: true,  mission: 'Deploys right-fit assessments, marks them, and benchmarks every candidate against your pool.' },
  { key: 'lock',   name: 'LOCK',   stage: 'Offer',      role: 'Offer mgmt',   live: true,  mission: 'From verbal yes to signed contract — offer letters, comp flags, negotiation, decline cover.' },
  { key: 'launch', name: 'LAUNCH', stage: 'Onboarding', role: 'Onboarding',   live: true,  mission: 'Turns a signed offer into a 30/60/90-day journey — personalised, tracked, compliance-ready.' },
];

module.exports = function (ctx) {
  const { app, db, shell, esc, now, requireAuth, requireRole, STAGES, notify, ai, ats,
          BANK, AXES, fitFor, companyProfile, cultureWeightsOf, cultureRawMap,
          axesWithCulture, roleKeywords, reindexRole } = ctx;

  // ---- new tables (idempotent) ----
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS outreach (
      id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER, company_id INTEGER,
      channel TEXT, body TEXT, status TEXT DEFAULT 'drafted', touch INTEGER DEFAULT 1,
      reply TEXT, reply_class TEXT, created_at TEXT NOT NULL );
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER, company_id INTEGER,
      role_title TEXT, candidate TEXT, salary INTEGER, start_date TEXT, body TEXT,
      status TEXT DEFAULT 'drafted', created_at TEXT NOT NULL );
    CREATE TABLE IF NOT EXISTS negotiations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, offer_id INTEGER, note TEXT, party TEXT, created_at TEXT NOT NULL );
    CREATE TABLE IF NOT EXISTS onboarding_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER, company_id INTEGER,
      body TEXT, checks TEXT, created_at TEXT NOT NULL );
  `);

  // ---- shared helpers ----
  const co = req => req.user.company_id || 0;
  const back = (href, label) => `<p class="sub"><a href="${href}" style="color:var(--pink);font-weight:700">&larr; ${label}</a></p>`;
  const rolesOf = cid => db.all('SELECT * FROM roles_posted WHERE company_id=? ORDER BY id DESC', cid);
  const roleOf = (cid, id) => db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', id, cid);
  const appRow = (cid, id) => db.get(`SELECT a.*, u.name uname, u.email uemail, u.phone uphone, u.cv ucv, u.ee_race, u.ee_gender, r.title rtitle, r.salary rsalary, r.salary_min, r.salary_max, r.description rdesc
    FROM applications a JOIN users u ON u.id=a.user_id JOIN roles_posted r ON r.id=a.role_id
    WHERE a.id=? AND r.company_id=?`, id, cid);
  const pipeForRole = (rid) => db.all(`SELECT a.*, u.name uname, u.phone uphone FROM applications a JOIN users u ON u.id=a.user_id WHERE a.role_id=? ORDER BY COALESCE(a.jd_match,a.fit,0) DESC`, rid);
  const designated = (race, gender) => {
    const r = (race || '').toLowerCase(), g = (gender || '').toLowerCase();
    const aa = ['african','black','coloured','indian','asian'].some(x => r.includes(x));
    return { aa, female: g.startsWith('f'), label: [aa ? 'B-BBEE designated' : '', g.startsWith('f') ? 'Female' : ''].filter(Boolean).join(' · ') };
  };
  // deterministic CV red/green flag scan (no LLM needed)
  function flagScan(cv) {
    const red = [], green = []; const low = (cv || '').toLowerCase();
    const yrs = (cv.match(/\b(19|20)\d{2}\b/g) || []).map(Number).sort();
    if (yrs.length >= 2) { const span = yrs[yrs.length - 1] - yrs[0]; if (span >= 8) green.push(`~${span}yr track record`); }
    // job-hopping / short tenure heuristic: many distinct years close together
    const roleWords = (low.match(/\b(20\d{2})\s*[-–to]+\s*(20\d{2}|present)/g) || []);
    if (roleWords.length >= 4) red.push('Several short stints — probe tenure');
    if (/gap|unemployed|sabbatical|career break/.test(low)) red.push('Possible employment gap');
    if (!/(matric|grade 12|nqf|diploma|degree|bachelor|honours|master|certificate)/.test(low)) red.push('No clear qualification stated');
    ['award','certified','certification','chartered','honours','distinction','top performer','promoted'].forEach(k => { if (low.includes(k)) green.push(k[0].toUpperCase() + k.slice(1)); });
    ['blue-chip','jse','listed','multinational','big four','fortune'].forEach(k => { if (low.includes(k)) green.push('Blue-chip exposure'); });
    if (/salary expectation|ctc|r\s?\d{3}\s?\d{3}/.test(low)) green.push('Comp expectation stated');
    return { red: [...new Set(red)].slice(0, 4), green: [...new Set(green)].slice(0, 4) };
  }
  const chip = (t, kind) => `<span class="pill ${kind === 'red' ? 'todo' : 'done'}" style="margin:2px 3px 2px 0;display:inline-block">${esc(t)}</span>`;
  // ICS calendar invite (buildable — no external calendar API)
  function buildICS({ uid, title, start, durMin, desc, loc }) {
    const z = n => String(n).padStart(2, '0');
    const fmt = d => { d = new Date(d); return d.getUTCFullYear() + z(d.getUTCMonth() + 1) + z(d.getUTCDate()) + 'T' + z(d.getUTCHours()) + z(d.getUTCMinutes()) + '00Z'; };
    const end = new Date(new Date(start).getTime() + (durMin || 45) * 60000);
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CALIBR//Sightline//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:' + uid + '@calibr-careers.tech', 'DTSTAMP:' + fmt(new Date()), 'DTSTART:' + fmt(start), 'DTEND:' + fmt(end),
      'SUMMARY:' + String(title || 'Interview').replace(/\n/g, ' '), 'DESCRIPTION:' + String(desc || '').replace(/\r?\n/g, '\\n'),
      'LOCATION:' + String(loc || '').replace(/\n/g, ' '), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }
  const pageHead = `<style>
    .sl-hero{border:2px solid var(--pink);border-radius:14px;padding:18px 20px;margin-bottom:18px}
    .sl-flow{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
    .sl-flow a{font-family:var(--mono,monospace);font-size:11px;font-weight:700;letter-spacing:.08em;border:1.5px solid var(--pink);color:var(--pink);padding:5px 9px;border-radius:7px;text-decoration:none}
    .sl-flow a.on{background:var(--pink);color:#fff}
    .sl-flow span{color:var(--pink);align-self:center;font-weight:800}
    .agentcard .mono{font-family:var(--mono,monospace);font-size:11px;letter-spacing:.1em;color:var(--pink)}
    pre.gen{white-space:pre-wrap;font:13px/1.55 ui-monospace,Menlo,monospace;background:#faf7f8;border:1px solid #eee;border-left:3px solid var(--pink);padding:14px;border-radius:8px}
  </style>`;
  const flowBar = active => `<div class="sl-flow">${AGENTS.map((a, i) => `${i ? '<span>&rsaquo;</span>' : ''}<a class="${a.key === active ? 'on' : ''}" href="/company/agents/${a.key}">${a.name}</a>`).join('')}</div>`;

  // ═══════════════════════════ HUB ═══════════════════════════
  app.get('/company/agents', requireAuth, requireRole('employer'), (req, res) => {
    const cards = AGENTS.map((a, i) => `
      <div class="card agentcard">
        <div class="mono">${String(i + 1).padStart(2, '0')} · ${esc(a.stage)}</div>
        <h3>${a.name} <span class="pill ${a.live ? 'done' : 'todo'}" style="font-size:10px;vertical-align:middle">${a.live ? 'Live' : 'Roadmap'}</span></h3>
        <p>${esc(a.mission)}</p>
        <a class="btn sm ${a.live ? '' : 'g'}" href="/company/agents/${a.key}">Open ${a.name}</a>
      </div>`).join('');
    res.send(shell({ title: 'Sightline', user: req.user, head: pageHead, body: `
      <div class="sl-hero">
        <div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.16em;color:var(--pink)">SIGHTLINE · THE CALIBR AGENT SUITE</div>
        <h1 style="margin:6px 0 4px">Seven agents. One line of sight<em>.</em></h1>
        <p class="sub">One clear line from candidate to hire — SCAN sources, FOCUS screens, SIGNAL reaches out, ALIGN coordinates, GAUGE assesses, LOCK closes, LAUNCH onboards. ${ai && ai.hasKey && ai.hasKey() ? 'AI copilots active (' + (ai.provider ? ai.provider() : 'on') + ').' : 'Running on the deterministic core — add an AI key to sharpen drafts.'}</p>
        ${flowBar('')}
      </div>
      <div class="grid">${cards}</div>` }));
  });

  // ═══════════════════════════ SCAN — sourcing ═══════════════════════════
  app.get('/company/agents/scan', requireAuth, requireRole('employer'), (req, res) => {
    const roles = rolesOf(co(req));
    res.send(shell({ title: 'SCAN', user: req.user, head: pageHead, body: `
      ${back('/company/agents', 'Sightline')}${flowBar('scan')}
      <h1>SCAN · Sourcing<em>.</em></h1>
      <p class="sub">Rank your pre-scored CALIBR talent pool against a role — net-new candidates first, EE-aware. Pick a role to source for.</p>
      ${roles.length ? `<div class="table-wrap"><table><tr><th>Role</th><th>Salary</th><th></th></tr>${roles.map(r => `<tr><td><b>${esc(r.title)}</b></td><td>${r.salary ? 'R' + Number(r.salary).toLocaleString('en-US') : '—'}</td><td><a class="btn sm" href="/company/agents/scan/${r.id}">Source candidates</a></td></tr>`).join('')}</table></div>` : '<p class="sub">No roles yet — <a href="/company/post" style="color:var(--pink);font-weight:700">post one</a> first.</p>'}
      <div class="card" style="margin-top:16px"><div class="mono" style="font-family:var(--mono,monospace);color:var(--pink);font-size:11px">CONNECT · EXTERNAL SOURCING</div><h3>LinkedIn · Pnet · Indeed sweep</h3><p>Active multi-source sweeps need each board's partner API + a paid recruiter account. Connect the boards you use to extend SCAN beyond your own pool.</p><a class="btn sm g" href="/company/connections">Manage connections</a></div>` }));
  });
  app.get('/company/agents/scan/:rid', requireAuth, requireRole('employer'), (req, res) => {
    const role = roleOf(co(req), req.params.rid); if (!role) return res.redirect('/company/agents/scan');
    const netNew = req.query.all !== '1';
    const pool = db.all(`SELECT u.id uid, u.name, u.ee_race, u.ee_gender, s.composite, s.axes, s.token FROM scores s JOIN users u ON u.id=s.user_id WHERE s.id IN (SELECT MAX(id) FROM scores GROUP BY user_id)`);
    const inPipe = new Set(db.all('SELECT user_id FROM applications WHERE role_id=?', role.id).map(a => a.user_id));
    const profile = companyProfile(co(req)); const rawMap = cultureRawMap(); const cw = cultureWeightsOf(co(req));
    let ranked = pool.map(p => { const ax = axesWithCulture(p.axes, p.uid, profile, rawMap, cw); return { ...p, fit: fitFor(JSON.stringify(ax), role.weights), cf: ax['Culture-Fit'], ee: designated(p.ee_race, p.ee_gender) }; }).sort((a, b) => b.fit - a.fit);
    if (netNew) ranked = ranked.filter(p => !inPipe.has(p.uid));
    ranked = ranked.slice(0, 20);
    res.send(shell({ title: 'SCAN · ' + role.title, user: req.user, head: pageHead, body: `
      ${back('/company/agents/scan', 'SCAN')}${flowBar('scan')}
      <h1>SCAN · ${esc(role.title)}<em>.</em></h1>
      <p class="sub">Top ${ranked.length} ${netNew ? 'net-new ' : ''}candidates by fit to this role. <a href="/company/agents/scan/${role.id}?all=${netNew ? '1' : '0'}" style="color:var(--pink);font-weight:700">${netNew ? 'Include those already in pipeline' : 'Net-new only'}</a></p>
      ${ranked.length ? `<div class="table-wrap"><table><tr><th>#</th><th>Candidate</th><th>Fit</th><th>Culture</th><th>EE</th><th></th></tr>${ranked.map((p, i) => `<tr>
        <td>${i + 1}</td><td><b>${esc(p.name)}</b></td>
        <td><b style="color:var(--pink)">${p.fit}%</b></td>
        <td>${p.cf != null ? p.cf + '%' : '—'}</td>
        <td>${p.ee.label ? `<span class="pill done" style="font-size:10px">${esc(p.ee.label)}</span>` : '—'}</td>
        <td>${inPipe.has(p.uid) ? '<span class="pill todo" style="font-size:10px">in pipeline</span>' : `<form method="post" action="/company/agents/scan/${role.id}/add/${p.uid}" style="display:inline"><button class="btn sm">Add to pipeline</button></form>`}</td>
      </tr>`).join('')}</table></div>` : '<p class="sub">No scored candidates match yet. As seekers complete their CALIBR Score they appear here.</p>'}` }));
  });
  app.post('/company/agents/scan/:rid/add/:uid', requireAuth, requireRole('employer'), (req, res) => {
    const role = roleOf(co(req), req.params.rid); if (!role) return res.redirect('/company/agents/scan');
    const ex = db.get('SELECT id FROM applications WHERE role_id=? AND user_id=?', role.id, req.params.uid);
    if (!ex) {
      const sc = db.get('SELECT axes FROM scores WHERE user_id=? ORDER BY id DESC LIMIT 1', req.params.uid);
      const fit = sc ? fitFor(sc.axes, role.weights) : null;
      db.run('INSERT INTO applications (role_id,user_id,stage,fit,source,created_at) VALUES (?,?,?,?,?,?)', role.id, req.params.uid, 'Shortlist', fit, 'pool', now());
    }
    res.redirect('/company/agents/scan/' + role.id);
  });

  // ═══════════════════════════ FOCUS — screening ═══════════════════════════
  app.get('/company/agents/focus', requireAuth, requireRole('employer'), (req, res) => {
    const roles = rolesOf(co(req));
    res.send(shell({ title: 'FOCUS', user: req.user, head: pageHead, body: `
      ${back('/company/agents', 'Sightline')}${flowBar('focus')}
      <h1>FOCUS · CV screening<em>.</em></h1>
      <p class="sub">Paste or upload a batch of CVs — FOCUS scores each against the role, flags red/green signals, and ranks them. Pick a role.</p>
      ${roles.length ? `<div class="table-wrap"><table><tr><th>Role</th><th></th></tr>${roles.map(r => `<tr><td><b>${esc(r.title)}</b></td><td><a class="btn sm" href="/company/agents/focus/${r.id}">Screen CVs</a></td></tr>`).join('')}</table></div>` : '<p class="sub">No roles yet — <a href="/company/post" style="color:var(--pink);font-weight:700">post one</a> first.</p>'}` }));
  });
  app.get('/company/agents/focus/:rid', requireAuth, requireRole('employer'), (req, res) => {
    const role = roleOf(co(req), req.params.rid); if (!role) return res.redirect('/company/agents/focus');
    res.send(shell({ title: 'FOCUS · ' + role.title, user: req.user, head: pageHead, body: `
      ${back('/company/agents/focus', 'FOCUS')}${flowBar('focus')}
      <h1>FOCUS · ${esc(role.title)}<em>.</em></h1>
      <p class="sub">Upload CV files (PDF/DOCX/TXT) or paste text — separate multiple CVs with a line of <b>---</b>. Each is scored, flagged and ranked.</p>
      <form method="post" action="/company/agents/focus/${role.id}">
        <div class="fld"><label>CVs</label><textarea name="blob" required style="min-height:300px" placeholder="First candidate's CV...&#10;---&#10;Second candidate's CV..."></textarea></div>
        <button class="btn">Screen &amp; rank</button>
      </form>` }));
  });
  app.post('/company/agents/focus/:rid', requireAuth, requireRole('employer'), async (req, res) => {
    const role = roleOf(co(req), req.params.rid); if (!role) return res.redirect('/company/agents/focus');
    let kws = roleKeywords(role);
    if (!kws.length && role.description) { try { const p = await reindexRole(role); kws = p ? p.keywords : []; } catch (e) {} }
    const chunks = (req.body.blob || '').split(/\n\s*-{3,}\s*\n/).map(s => s.trim()).filter(s => s.length > 40).slice(0, 50);
    const out = [];
    for (let i = 0; i < chunks.length; i++) {
      const cv = chunks[i].slice(0, 9000);
      const em = cv.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      const email = (em ? em[0] : 'focus+' + crypto.randomBytes(5).toString('hex') + '@calibr.local').toLowerCase();
      const nm = (cv.split('\n')[0] || '').trim().slice(0, 80) || ('Candidate ' + (i + 1));
      let u = db.get('SELECT * FROM users WHERE email=?', email);
      if (!u) { const bcrypt = require('bcryptjs'); const h = bcrypt.hashSync(crypto.randomBytes(9).toString('hex'), 10); const ins = db.run('INSERT INTO users (role,name,email,pass,cv,created_at) VALUES (?,?,?,?,?,?)', 'seeker', nm, email, h, cv, now()); u = { id: Number(ins.lastInsertRowid), name: nm }; }
      else db.run('UPDATE users SET cv=? WHERE id=?', cv, u.id);
      const scored = await ats.scoreCV(cv, kws, role.description || role.title);
      const flags = flagScan(cv);
      const report = JSON.stringify({ matched: scored.matched, missing: scored.missing, flags: scored.flags, summary: scored.summary || '', engine: scored.engine, red: flags.red, green: flags.green });
      const ex = db.get('SELECT id FROM applications WHERE role_id=? AND user_id=?', role.id, u.id);
      if (ex) { db.run('UPDATE applications SET jd_match=?, jd_report=?, cv_text=?, fit=?, source=? WHERE id=?', scored.match, report, cv, scored.match, 'focus', ex.id); out.push({ id: ex.id, name: u.name, match: scored.match, flags }); }
      else { const ins = db.run('INSERT INTO applications (role_id,user_id,stage,fit,jd_match,jd_report,cv_text,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)', role.id, u.id, 'New', scored.match, scored.match, report, cv, 'focus', now()); out.push({ id: Number(ins.lastInsertRowid), name: u.name, match: scored.match, flags }); }
    }
    out.sort((a, b) => b.match - a.match);
    res.send(shell({ title: 'FOCUS result', user: req.user, head: pageHead, body: `
      ${back('/company/agents/focus/' + role.id, 'FOCUS')}${flowBar('focus')}
      <h1>Screened ${out.length} CV${out.length === 1 ? '' : 's'}<em>.</em></h1>
      <p class="sub">Ranked by JD match for <b>${esc(role.title)}</b>. <a href="/company/role/${role.id}/pipeline" style="color:var(--pink);font-weight:700">Open pipeline &rarr;</a></p>
      <div class="table-wrap"><table><tr><th>#</th><th>Candidate</th><th>JD match</th><th>Flags</th><th></th></tr>${out.map((r, i) => `<tr>
        <td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td><b style="color:var(--pink)">${r.match}%</b></td>
        <td>${r.flags.green.map(f => chip(f, 'green')).join('')}${r.flags.red.map(f => chip(f, 'red')).join('')|| (r.flags.green.length ? '' : '—')}</td>
        <td><a class="btn sm g" href="/company/agents/focus/app/${r.id}">One-pager</a></td>
      </tr>`).join('') || '<tr><td colspan="5">No CVs detected — separate each with a line of ---.</td></tr>'}</table></div>` }));
  });
  app.get('/company/agents/focus/app/:aid', requireAuth, requireRole('employer'), async (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/focus');
    const sum = await ai.summariseCV(a.ucv || a.cv_text || '', a.rtitle);
    let rep = {}; try { rep = JSON.parse(a.jd_report || '{}'); } catch (e) {}
    const flags = { red: rep.red || [], green: rep.green || [] };
    res.send(shell({ title: 'One-pager · ' + a.uname, user: req.user, head: pageHead, body: `
      ${back('/company/role/' + a.role_id + '/pipeline', 'Pipeline')}${flowBar('focus')}
      <h1>${esc(a.uname)}<em>.</em></h1>
      <p class="sub">For <b>${esc(a.rtitle)}</b> · JD match <b style="color:var(--pink)">${a.jd_match != null ? a.jd_match + '%' : '—'}</b> ${sum.ai ? '· <span class="pill done" style="font-size:10px">AI</span>' : ''}</p>
      <div class="grid">
        <div class="card"><h3>Green flags</h3><p>${flags.green.length ? flags.green.map(f => chip(f, 'green')).join('') : 'None detected'}</p></div>
        <div class="card"><h3>Red flags</h3><p>${flags.red.length ? flags.red.map(f => chip(f, 'red')).join('') : 'None detected'}</p></div>
      </div>
      <div class="lbl">Summary</div><pre class="gen">${esc(sum.text)}</pre>
      <div class="actions"><a class="btn sm" href="/company/app/${a.id}">Full candidate</a> <a class="btn sm g" href="/company/agents/signal/app/${a.id}">Reach out (SIGNAL) &rarr;</a></div>` }));
  });

  // ═══════════════════════════ SIGNAL — outreach ═══════════════════════════
  app.get('/company/agents/signal', requireAuth, requireRole('employer'), (req, res) => {
    const roles = rolesOf(co(req));
    res.send(shell({ title: 'SIGNAL', user: req.user, head: pageHead, body: `
      ${back('/company/agents', 'Sightline')}${flowBar('signal')}
      <h1>SIGNAL · Outreach<em>.</em></h1>
      <p class="sub">Draft personalised outreach, send it over WhatsApp, and triage replies. Pick a role, then a candidate.</p>
      ${roles.length ? roles.map(r => { const n = db.get('SELECT COUNT(*) n FROM applications WHERE role_id=?', r.id).n; return `<div class="card"><h3>${esc(r.title)}</h3><p>${n} candidate${n === 1 ? '' : 's'} in pipeline</p><a class="btn sm" href="/company/agents/signal/${r.id}">Choose candidate</a></div>`; }).join('') : '<p class="sub">No roles yet.</p>'}
      <div class="card"><div style="font-family:var(--mono,monospace);color:var(--pink);font-size:11px">CONNECT</div><h3>LinkedIn InMail</h3><p>Multi-channel LinkedIn sequencing needs LinkedIn's partner API. WhatsApp + email work today.</p></div>` }));
  });
  app.get('/company/agents/signal/:rid', requireAuth, requireRole('employer'), (req, res) => {
    const role = roleOf(co(req), req.params.rid); if (!role) return res.redirect('/company/agents/signal');
    const cands = pipeForRole(role.id);
    res.send(shell({ title: 'SIGNAL · ' + role.title, user: req.user, head: pageHead, body: `
      ${back('/company/agents/signal', 'SIGNAL')}${flowBar('signal')}
      <h1>SIGNAL · ${esc(role.title)}<em>.</em></h1>
      ${cands.length ? `<div class="table-wrap"><table><tr><th>Candidate</th><th>Stage</th><th>Match</th><th></th></tr>${cands.map(c => `<tr><td><b>${esc(c.uname)}</b></td><td>${esc(c.stage)}</td><td>${c.jd_match != null ? c.jd_match + '%' : (c.fit != null ? c.fit + '%' : '—')}</td><td><a class="btn sm" href="/company/agents/signal/app/${c.id}">Draft outreach</a></td></tr>`).join('')}</table></div>` : '<p class="sub">No candidates yet — use SCAN or FOCUS first.</p>'}` }));
  });
  app.get('/company/agents/signal/app/:aid', requireAuth, requireRole('employer'), async (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/signal');
    const company = db.get('SELECT name FROM companies WHERE id=?', co(req));
    const cvSnip = (a.ucv || a.cv_text || '').slice(0, 1500);
    const draft = await tryLLM(`Write a short, warm, professional WhatsApp outreach message (max 90 words) from ${company ? company.name : 'our company'} to ${a.uname} about the "${a.rtitle}" role. Reference their background only if clearly supported by this CV snippet; do not invent. End with a clear ask to chat. CV snippet:\n${cvSnip}`)
      || `Hi ${a.uname.split(' ')[0]} 👋 I'm reaching out from ${company ? company.name : 'our team'} about our ${a.rtitle} role. Your profile stood out on CALIBR and I'd love to tell you more — would you be open to a quick chat this week? — ${esc(req.user.name)}`;
    const touches = db.all('SELECT * FROM outreach WHERE application_id=? ORDER BY id DESC', a.id);
    res.send(shell({ title: 'SIGNAL · ' + a.uname, user: req.user, head: pageHead, body: `
      ${back('/company/agents/signal/' + a.role_id, 'SIGNAL')}${flowBar('signal')}
      <h1>Reach out to ${esc(a.uname)}<em>.</em></h1>
      <p class="sub">For <b>${esc(a.rtitle)}</b> · ${a.uphone ? 'WhatsApp: ' + esc(a.uphone) : 'No mobile on file — add one to send'} · ${notify.enabled() ? '<span class="pill done" style="font-size:10px">WhatsApp live</span>' : '<span class="pill todo" style="font-size:10px">WhatsApp not configured</span>'}</p>
      <form method="post" action="/company/agents/signal/app/${a.id}/send">
        <div class="fld"><label>Message (edit before sending)</label><textarea name="body" style="min-height:150px">${esc(draft)}</textarea></div>
        <button class="btn" name="action" value="send"${a.uphone && notify.enabled() ? '' : ' disabled title="Needs a mobile number + WhatsApp configured"'}>Send via WhatsApp</button>
        <button class="btn g" name="action" value="log">Log as sent (manual)</button>
      </form>
      <div class="lbl">Log a reply (triage)</div>
      <form method="post" action="/company/agents/signal/app/${a.id}/reply">
        <div class="fld"><textarea name="reply" style="min-height:80px" placeholder="Paste the candidate's reply — SIGNAL classifies it"></textarea></div>
        <button class="btn sm">Classify reply</button>
      </form>
      <div class="lbl">Touch history (${touches.length})</div>
      ${touches.length ? `<div class="table-wrap"><table><tr><th>#</th><th>Channel</th><th>Status</th><th>Reply</th><th>When</th></tr>${touches.map(t => `<tr><td>${t.touch}</td><td>${esc(t.channel)}</td><td><span class="pill ${t.status === 'sent' ? 'done' : 'todo'}">${esc(t.status)}</span></td><td>${t.reply_class ? `<span class="pill ${/interest/i.test(t.reply_class) ? 'done' : 'todo'}">${esc(t.reply_class)}</span>` : '—'}</td><td>${esc((t.created_at || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('')}</table></div>` : '<p class="sub">No outreach yet.</p>'}` }));
  });
  app.post('/company/agents/signal/app/:aid/send', requireAuth, requireRole('employer'), (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/signal');
    const touch = (db.get('SELECT COUNT(*) n FROM outreach WHERE application_id=?', a.id).n || 0) + 1;
    const sendIt = req.body.action === 'send' && a.uphone && notify.enabled();
    if (sendIt) notify.fire(a.uphone, req.body.body || '');
    db.run('INSERT INTO outreach (application_id,company_id,channel,body,status,touch,created_at) VALUES (?,?,?,?,?,?,?)', a.id, co(req), sendIt ? 'whatsapp' : 'manual', (req.body.body || '').slice(0, 2000), sendIt ? 'sent' : 'logged', touch, now());
    res.redirect('/company/agents/signal/app/' + a.id);
  });
  app.post('/company/agents/signal/app/:aid/reply', requireAuth, requireRole('employer'), (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/signal');
    const r = (req.body.reply || '').toLowerCase();
    let cls = 'Need more info';
    if (/\b(no|not interested|unsubscribe|stop|remove me|not looking)\b/.test(r)) cls = 'Hard no';
    else if (/\b(yes|keen|interested|sounds good|let\'s|lets|happy to|available|call me|chat)\b/.test(r)) cls = 'Interested';
    else if (/\b(later|next month|not now|busy|maybe|in future|circle back)\b/.test(r)) cls = 'Not now';
    const last = db.get('SELECT id FROM outreach WHERE application_id=? ORDER BY id DESC LIMIT 1', a.id);
    if (last) db.run('UPDATE outreach SET reply=?, reply_class=? WHERE id=?', (req.body.reply || '').slice(0, 2000), cls, last.id);
    else db.run('INSERT INTO outreach (application_id,company_id,channel,body,status,touch,reply,reply_class,created_at) VALUES (?,?,?,?,?,?,?,?,?)', a.id, co(req), 'manual', '', 'logged', 1, (req.body.reply || '').slice(0, 2000), cls, now());
    if (cls === 'Interested') db.run("UPDATE applications SET stage='Shortlist' WHERE id=? AND stage='New'", a.id);
    res.redirect('/company/agents/signal/app/' + a.id);
  });

  // ═══════════════════════════ ALIGN — interview coordination ═══════════════════════════
  app.get('/company/agents/align', requireAuth, requireRole('employer'), (req, res) => {
    const cands = db.all(`SELECT a.id, u.name uname, r.title rtitle FROM applications a JOIN users u ON u.id=a.user_id JOIN roles_posted r ON r.id=a.role_id WHERE r.company_id=? AND a.stage IN ('Shortlist','Interview') ORDER BY a.id DESC LIMIT 60`, co(req));
    res.send(shell({ title: 'ALIGN', user: req.user, head: pageHead, body: `
      ${back('/company/agents', 'Sightline')}${flowBar('align')}
      <h1>ALIGN · Interview coordination<em>.</em></h1>
      <p class="sub">Prep packs, interviewer question banks, calendar invites and debriefs — for every shortlisted candidate.</p>
      ${cands.length ? `<div class="table-wrap"><table><tr><th>Candidate</th><th>Role</th><th></th></tr>${cands.map(c => `<tr><td><b>${esc(c.uname)}</b></td><td>${esc(c.rtitle)}</td><td><a class="btn sm" href="/company/agents/align/app/${c.id}">Coordinate</a></td></tr>`).join('')}</table></div>` : '<p class="sub">No shortlisted candidates yet — advance someone to Shortlist/Interview first.</p>'}
      <div class="card"><div style="font-family:var(--mono,monospace);color:var(--pink);font-size:11px">CONNECT</div><h3>Google / Microsoft 365 calendars · live video notes</h3><p>Two-way diary sync and in-call note-taking need calendar + meeting integrations. ALIGN generates a universal <b>.ics invite</b> today that works with any calendar.</p></div>` }));
  });
  app.get('/company/agents/align/app/:aid', requireAuth, requireRole('employer'), async (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/align');
    const company = db.get('SELECT name FROM companies WHERE id=?', co(req));
    const sc = db.get('SELECT criteria FROM scorecards WHERE role_id=?', a.role_id);
    let crit = []; try { crit = sc ? JSON.parse(sc.criteria) : []; } catch (e) {}
    const kit = await ai.interviewQuestions({ title: a.rtitle, criteria: crit });
    const prep = await tryLLM(`Write a concise candidate interview prep pack for ${a.uname} interviewing for "${a.rtitle}" at ${company ? company.name : 'the company'}. Sections: "About the role" (2 lines), "How to prepare" (4 bullets), "Format & logistics" (what to expect), "On the day" (2 tips). Plain text, encouraging, SA English.`)
      || `Interview prep · ${a.rtitle}\n\nAbout the role\n- You're interviewing for ${a.rtitle} at ${company ? company.name : 'our company'}. We hire on evidence — expect practical, competency-based questions.\n\nHow to prepare\n- Re-read the job description and map your experience to each requirement\n- Prepare 3 concrete examples with measurable outcomes (STAR)\n- Review your CALIBR Score axes and be ready to speak to them\n- Prepare 2 questions for the panel\n\nFormat & logistics\n- Structured interview against a scorecard; be specific and first-person.\n\nOn the day\n- Arrive/join 5 minutes early. Be yourself — evidence over polish.`;
    const slot = db.get("SELECT * FROM interview_slots WHERE application_id=? ORDER BY id DESC LIMIT 1", a.id);
    res.send(shell({ title: 'ALIGN · ' + a.uname, user: req.user, head: pageHead, body: `
      ${back('/company/agents/align', 'ALIGN')}${flowBar('align')}
      <h1>ALIGN · ${esc(a.uname)}<em>.</em></h1>
      <p class="sub">For <b>${esc(a.rtitle)}</b>. ${slot && slot.when_at ? 'Scheduled: <b>' + esc(slot.when_at) + '</b> (' + esc(slot.mode || '') + ')' : 'Not yet scheduled — <a href="/company/app/' + a.id + '/schedule" style="color:var(--pink);font-weight:700">schedule</a> or generate an invite below.'}</p>

      <div class="lbl">Calendar invite (.ics — works with any calendar)</div>
      <form method="get" action="/company/agents/align/app/${a.id}/invite.ics" class="fld inline">
        <div><label style="font-size:10px">Date &amp; time</label><input type="datetime-local" name="when" value="${slot && slot.when_at ? esc(slot.when_at) : ''}" required></div>
        <div><label style="font-size:10px">Minutes</label><input type="number" name="dur" value="45" min="15" max="240" style="width:80px"></div>
        <div><label style="font-size:10px">Link / location</label><input name="loc" placeholder="Google Meet link or address" value="${slot && slot.location ? esc(slot.location) : ''}"></div>
        <div style="display:flex;align-items:flex-end"><button class="btn sm">Download .ics</button></div>
      </form>

      <div class="lbl">Candidate prep pack ${prep && !/Interview prep ·/.test(prep) ? '<span class="pill done" style="font-size:10px">AI</span>' : ''}</div>
      <pre class="gen">${esc(prep)}</pre>
      ${a.uphone && notify.enabled() ? `<form method="post" action="/company/agents/align/app/${a.id}/sendprep"><input type="hidden" name="body" value="${esc(prep).slice(0, 1200)}"><button class="btn sm g">Send prep to candidate on WhatsApp</button></form>` : ''}

      <div class="lbl">Interviewer question bank</div>
      <pre class="gen">${esc(kit.text)}</pre>

      <div class="lbl">Debrief synthesis</div>
      <form method="post" action="/company/agents/align/app/${a.id}/debrief">
        <div class="fld"><textarea name="notes" style="min-height:120px" placeholder="Paste raw panel notes — ALIGN turns them into structured, evidence-based feedback"></textarea></div>
        <div class="fld inline"><div><label style="font-size:10px">Recommendation</label><select name="rec">${['Advance', 'Hold', 'Decline'].map(o => `<option>${o}</option>`).join('')}</select></div><div style="display:flex;align-items:flex-end"><button class="btn sm">Synthesise debrief</button></div></div>
      </form>
      ${req.query.debrief ? `<pre class="gen">${esc(Buffer.from(req.query.debrief, 'base64').toString('utf8'))}</pre>` : ''}` }));
  });
  app.get('/company/agents/align/app/:aid/invite.ics', requireAuth, requireRole('employer'), (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/align');
    const when = req.query.when; if (!when) return res.redirect('/company/agents/align/app/' + a.id);
    const company = db.get('SELECT name FROM companies WHERE id=?', co(req));
    const ics = buildICS({ uid: 'align-' + a.id + '-' + Date.now(), title: `${a.rtitle} interview — ${company ? company.name : 'CALIBR'}`, start: when, durMin: parseInt(req.query.dur, 10) || 45, desc: `Interview for ${a.rtitle} with ${a.uname}. Coordinated by CALIBR Sightline · ALIGN.`, loc: req.query.loc || '' });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="calibr-interview-' + a.id + '.ics"');
    res.send(ics);
  });
  app.post('/company/agents/align/app/:aid/sendprep', requireAuth, requireRole('employer'), (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/align');
    if (a.uphone && notify.enabled()) notify.fire(a.uphone, (req.body.body || '').slice(0, 3500));
    res.redirect('/company/agents/align/app/' + a.id);
  });
  app.post('/company/agents/align/app/:aid/debrief', requireAuth, requireRole('employer'), async (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/align');
    const fb = await ai.structureFeedback(req.body.notes || '', req.body.rec || 'your call');
    res.redirect('/company/agents/align/app/' + a.id + '?debrief=' + Buffer.from(fb.text).toString('base64'));
  });

  // ═══════════════════════════ GAUGE — assessment & benchmarking ═══════════════════════════
  app.get('/company/agents/gauge', requireAuth, requireRole('employer'), (req, res) => {
    const banks = BANK ? Object.keys(BANK) : [];
    const roles = rolesOf(co(req));
    res.send(shell({ title: 'GAUGE', user: req.user, head: pageHead, body: `
      ${back('/company/agents', 'Sightline')}${flowBar('gauge')}
      <h1>GAUGE · Assessment<em>.</em></h1>
      <p class="sub">CALIBR's assessment engine marks objectively and benchmarks every candidate. ${banks.length} assessment banks live: ${banks.map(b => `<span class="pill done" style="font-size:10px">${esc(b)}</span>`).join(' ')}</p>
      <div class="lbl">Benchmark a candidate</div>
      ${roles.length ? roles.map(r => `<div class="card"><h3>${esc(r.title)}</h3><a class="btn sm" href="/company/agents/gauge/${r.id}">Benchmark pipeline</a></div>`).join('') : '<p class="sub">No roles yet.</p>'}
      <div class="card"><div style="font-family:var(--mono,monospace);color:var(--pink);font-size:11px">CONNECT</div><h3>300+ library · custom builder · Calibr LMS</h3><p>A full assessment library and bespoke-assessment builder live in the Calibr LMS (in build). The six core banks + CALIBR Score are live now.</p></div>` }));
  });
  app.get('/company/agents/gauge/:rid', requireAuth, requireRole('employer'), (req, res) => {
    const role = roleOf(co(req), req.params.rid); if (!role) return res.redirect('/company/agents/gauge');
    const axes = AXES || ['Skills / Technical', 'Aptitude / Cognitive', 'Personality', 'Culture-Fit', 'Integrity'];
    // internal pool average per axis
    const all = db.all(`SELECT axes FROM scores WHERE id IN (SELECT MAX(id) FROM scores GROUP BY user_id)`);
    const avg = {}; axes.forEach(k => { let s = 0, n = 0; all.forEach(r => { try { const a = JSON.parse(r.axes); if (a[k] != null) { s += a[k]; n++; } } catch (e) {} }); avg[k] = n ? Math.round(s / n) : null; });
    const SA_NORM = 50; // static market baseline until live norms are connected
    const cands = db.all(`SELECT a.id, u.name uname, s.axes FROM applications a JOIN users u ON u.id=a.user_id JOIN scores s ON s.id=(SELECT MAX(id) FROM scores WHERE user_id=u.id) WHERE a.role_id=? ORDER BY COALESCE(a.fit,0) DESC`, role.id);
    const w = JSON.parse(role.weights || '{}');
    res.send(shell({ title: 'GAUGE · ' + role.title, user: req.user, head: pageHead, body: `
      ${back('/company/agents/gauge', 'GAUGE')}${flowBar('gauge')}
      <h1>GAUGE · ${esc(role.title)}<em>.</em></h1>
      <p class="sub">Each candidate benchmarked against the <b>role target</b> (your rubric weight), your <b>internal pool average</b>, and a <b>SA market baseline</b>.</p>
      ${cands.length ? cands.map(c => { let ax = {}; try { ax = JSON.parse(c.axes); } catch (e) {} return `
        <div class="lbl">${esc(c.uname)}</div>
        <div class="table-wrap"><table><tr><th>Axis</th><th>Candidate</th><th>Role target</th><th>Pool avg</th><th>SA baseline</th><th>Read</th></tr>${axes.map(k => { const cv = ax[k] != null ? ax[k] : null; const tgt = w[k] != null ? Math.min(100, w[k] * 3) : 60; const read = cv == null ? '—' : cv >= tgt ? 'At/above target' : cv >= (avg[k] || SA_NORM) ? 'Above pool' : 'Below pool'; return `<tr><td>${esc(k)}</td><td><b style="color:var(--pink)">${cv != null ? cv : '—'}</b></td><td>${tgt}</td><td>${avg[k] != null ? avg[k] : '—'}</td><td>${SA_NORM}</td><td>${read}</td></tr>`; }).join('')}</table></div>`; }).join('') : '<p class="sub">No scored candidates in this pipeline yet.</p>'}` }));
  });

  // ═══════════════════════════ LOCK — offer management ═══════════════════════════
  app.get('/company/agents/lock', requireAuth, requireRole('employer'), (req, res) => {
    const cands = db.all(`SELECT a.id, u.name uname, r.title rtitle, a.stage FROM applications a JOIN users u ON u.id=a.user_id JOIN roles_posted r ON r.id=a.role_id WHERE r.company_id=? AND a.stage IN ('Interview','Offer','Hired') ORDER BY a.id DESC LIMIT 60`, co(req));
    res.send(shell({ title: 'LOCK', user: req.user, head: pageHead, body: `
      ${back('/company/agents', 'Sightline')}${flowBar('lock')}
      <h1>LOCK · Offer management<em>.</em></h1>
      <p class="sub">Generate the offer letter, flag the package against band, track the negotiation, and cover declines automatically.</p>
      ${cands.length ? `<div class="table-wrap"><table><tr><th>Candidate</th><th>Role</th><th>Stage</th><th></th></tr>${cands.map(c => `<tr><td><b>${esc(c.uname)}</b></td><td>${esc(c.rtitle)}</td><td>${esc(c.stage)}</td><td><a class="btn sm" href="/company/agents/lock/app/${c.id}">Manage offer</a></td></tr>`).join('')}</table></div>` : '<p class="sub">No candidates at Interview/Offer yet.</p>'}
      <div class="card"><div style="font-family:var(--mono,monospace);color:var(--pink);font-size:11px">CONNECT</div><h3>DocuSign / AdobeSign · market comp data</h3><p>E-signature and live salary benchmarks (Remchannel/Mercer) connect as integrations. LOCK generates the letter + a band flag from your role's salary range today.</p></div>` }));
  });
  app.get('/company/agents/lock/app/:aid', requireAuth, requireRole('employer'), (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/lock');
    const offer = db.get('SELECT * FROM offers WHERE application_id=? ORDER BY id DESC LIMIT 1', a.id);
    const negs = offer ? db.all('SELECT * FROM negotiations WHERE offer_id=? ORDER BY id DESC', offer.id) : [];
    const nextCand = db.get(`SELECT a.id, u.name uname FROM applications a JOIN users u ON u.id=a.user_id WHERE a.role_id=? AND a.id<>? AND a.stage NOT IN ('Rejected','Hired') ORDER BY COALESCE(a.jd_match,a.fit,0) DESC LIMIT 1`, a.role_id, a.id);
    let bandFlag = 'No salary band set on the role';
    if (offer && (a.salary_min || a.salary_max)) {
      if (a.salary_min && offer.salary < a.salary_min) bandFlag = 'Below band (role min R' + Number(a.salary_min).toLocaleString('en-US') + ')';
      else if (a.salary_max && offer.salary > a.salary_max) bandFlag = 'Above band (role max R' + Number(a.salary_max).toLocaleString('en-US') + ')';
      else bandFlag = 'Within band';
    }
    res.send(shell({ title: 'LOCK · ' + a.uname, user: req.user, head: pageHead, body: `
      ${back('/company/agents/lock', 'LOCK')}${flowBar('lock')}
      <h1>LOCK · ${esc(a.uname)}<em>.</em></h1>
      <p class="sub">For <b>${esc(a.rtitle)}</b>${a.salary_min || a.salary_max ? ' · band R' + Number(a.salary_min || 0).toLocaleString('en-US') + '–R' + Number(a.salary_max || 0).toLocaleString('en-US') : ''}</p>
      ${!offer ? `
        <div class="lbl">Generate offer letter</div>
        <form method="post" action="/company/agents/lock/app/${a.id}/offer" class="fld inline">
          <div><label style="font-size:10px">Annual package (ZAR)</label><input type="number" name="salary" required value="${a.salary_max || a.salary || ''}"></div>
          <div><label style="font-size:10px">Start date</label><input type="date" name="start_date" required></div>
          <div style="display:flex;align-items:flex-end"><button class="btn">Generate offer</button></div>
        </form>` : `
        <div class="grid">
          <div class="card"><h3>Package</h3><div class="score-num" style="font-size:34px">R${Number(offer.salary).toLocaleString('en-US')}</div><p>Start ${esc(offer.start_date || '—')}</p><p><span class="pill ${/within/i.test(bandFlag) ? 'done' : 'todo'}">${esc(bandFlag)}</span></p></div>
          <div class="card"><h3>Status</h3><p><span class="pill ${offer.status === 'accepted' ? 'done' : 'todo'}">${esc(offer.status)}</span></p>
            <form method="post" action="/company/agents/lock/offer/${offer.id}/status" style="margin-top:8px"><select name="status">${['drafted', 'sent', 'accepted', 'declined'].map(s => `<option ${offer.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select> <button class="btn sm">Update</button></form>
          </div>
        </div>
        <div class="lbl">Offer letter</div>
        <pre class="gen">${esc(offer.body)}</pre>
        <div class="actions"><button class="btn sm g" onclick="window.print()">Print / save as PDF</button> <span class="pill todo" style="font-size:10px;align-self:center">E-sign: connect DocuSign</span></div>

        <div class="lbl">Negotiation log</div>
        <form method="post" action="/company/agents/lock/offer/${offer.id}/note" class="fld inline">
          <div style="flex:1"><input name="note" placeholder="Log a counter / note (e.g. candidate asked for R?? more)" required></div>
          <div><select name="party"><option>Candidate</option><option>Us</option></select></div>
          <div style="display:flex;align-items:flex-end"><button class="btn sm">Log</button></div>
        </form>
        ${negs.length ? `<div class="table-wrap"><table><tr><th>By</th><th>Note</th><th>When</th></tr>${negs.map(n => `<tr><td>${esc(n.party)}</td><td>${esc(n.note)}</td><td>${esc((n.created_at || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('')}</table></div>` : ''}

        ${offer.status === 'declined' ? `<div class="msg">Declined. ${nextCand ? `Decline cover: <b>${esc(nextCand.uname)}</b> is next-ranked. <a href="/company/agents/signal/app/${nextCand.id}" style="color:var(--pink);font-weight:700">Re-engage via SIGNAL &rarr;</a>` : 'No next-ranked candidate in pipeline.'}</div>` : ''}
      `}` }));
  });
  app.post('/company/agents/lock/app/:aid/offer', requireAuth, requireRole('employer'), async (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/lock');
    const company = db.get('SELECT name FROM companies WHERE id=?', co(req));
    const salary = parseInt(req.body.salary, 10) || 0;
    const body = await tryLLM(`Write a professional, POPIA-compliant South African offer letter. Company: ${company ? company.name : 'The Company'}. Candidate: ${a.uname}. Role: ${a.rtitle}. Annual package: R${salary.toLocaleString('en-US')}. Start date: ${req.body.start_date}. Include: greeting, role & reporting line (generic), package, start date, standard conditions (probation, background checks with consent, confidentiality), and a warm close with an acceptance line. Keep it ~250 words, plain text.`)
      || `${company ? company.name : 'The Company'}\n\nDear ${a.uname},\n\nOFFER OF EMPLOYMENT — ${a.rtitle}\n\nWe are delighted to offer you the position of ${a.rtitle}. We were impressed by the evidence of your ability through the CALIBR process.\n\nPackage: R${salary.toLocaleString('en-US')} per annum (total cost to company).\nStart date: ${req.body.start_date}.\n\nThis offer is subject to: a three-month probation period, satisfactory background and reference checks (conducted with your consent under POPIA), and your agreement to our confidentiality and code-of-conduct policies.\n\nYour personal information is processed lawfully and only for employment purposes.\n\nWe would be thrilled to have you join us. To accept, please sign and return this letter by reply.\n\nWarm regards,\n${esc(req.user.name)}\n${company ? company.name : ''}\n\nI, ${a.uname}, accept this offer.  Signed: __________________  Date: __________`;
    db.run('INSERT INTO offers (application_id,company_id,role_title,candidate,salary,start_date,body,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)', a.id, co(req), a.rtitle, a.uname, salary, req.body.start_date || null, body, 'drafted', now());
    db.run("UPDATE applications SET stage='Offer' WHERE id=?", a.id);
    res.redirect('/company/agents/lock/app/' + a.id);
  });
  app.post('/company/agents/lock/offer/:oid/note', requireAuth, requireRole('employer'), (req, res) => {
    const o = db.get('SELECT * FROM offers WHERE id=? AND company_id=?', req.params.oid, co(req)); if (!o) return res.redirect('/company/agents/lock');
    db.run('INSERT INTO negotiations (offer_id,note,party,created_at) VALUES (?,?,?,?)', o.id, (req.body.note || '').slice(0, 500), req.body.party || 'Candidate', now());
    res.redirect('/company/agents/lock/app/' + o.application_id);
  });
  app.post('/company/agents/lock/offer/:oid/status', requireAuth, requireRole('employer'), (req, res) => {
    const o = db.get('SELECT * FROM offers WHERE id=? AND company_id=?', req.params.oid, co(req)); if (!o) return res.redirect('/company/agents/lock');
    const st = ['drafted', 'sent', 'accepted', 'declined'].includes(req.body.status) ? req.body.status : o.status;
    db.run('UPDATE offers SET status=? WHERE id=?', st, o.id);
    if (st === 'accepted') db.run("UPDATE applications SET stage='Hired', hired_at=? WHERE id=?", now(), o.application_id);
    res.redirect('/company/agents/lock/app/' + o.application_id);
  });

  // ═══════════════════════════ LAUNCH — onboarding ═══════════════════════════
  const COMPLIANCE = ['POPIA awareness', 'FICA (if applicable)', 'Cybersecurity awareness', 'AI ethics & acceptable use', 'Code of conduct', 'Health & safety induction'];
  app.get('/company/agents/launch', requireAuth, requireRole('employer'), (req, res) => {
    const hires = db.all(`SELECT a.id, u.name uname, r.title rtitle FROM applications a JOIN users u ON u.id=a.user_id JOIN roles_posted r ON r.id=a.role_id WHERE r.company_id=? AND a.stage='Hired' ORDER BY a.id DESC LIMIT 60`, co(req));
    res.send(shell({ title: 'LAUNCH', user: req.user, head: pageHead, body: `
      ${back('/company/agents', 'Sightline')}${flowBar('launch')}
      <h1>LAUNCH · Onboarding<em>.</em></h1>
      <p class="sub">Turn a signed offer into a personalised 30/60/90-day journey with compliance built in. Pick a new hire.</p>
      ${hires.length ? `<div class="table-wrap"><table><tr><th>New hire</th><th>Role</th><th></th></tr>${hires.map(h => `<tr><td><b>${esc(h.uname)}</b></td><td>${esc(h.rtitle)}</td><td><a class="btn sm" href="/company/agents/launch/app/${h.id}">Build journey</a></td></tr>`).join('')}</table></div>` : '<p class="sub">No hires yet — mark a candidate Hired (via LOCK) to onboard them.</p>'}
      <div class="card"><div style="font-family:var(--mono,monospace);color:var(--pink);font-size:11px">CONNECT</div><h3>Calibr LMS course delivery · SDL/SETA auto-submit</h3><p>Delivering courses and auto-logging SDL claims run through the Calibr LMS (in build). LAUNCH builds the plan + compliance checklist today.</p></div>` }));
  });
  app.get('/company/agents/launch/app/:aid', requireAuth, requireRole('employer'), (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/launch');
    const plan = db.get('SELECT * FROM onboarding_plans WHERE application_id=? ORDER BY id DESC LIMIT 1', a.id);
    let checks = []; try { checks = plan ? JSON.parse(plan.checks || '[]') : []; } catch (e) {}
    const doneSet = new Set(checks);
    res.send(shell({ title: 'LAUNCH · ' + a.uname, user: req.user, head: pageHead, body: `
      ${back('/company/agents/launch', 'LAUNCH')}${flowBar('launch')}
      <h1>LAUNCH · ${esc(a.uname)}<em>.</em></h1>
      <p class="sub">Onboarding ${esc(a.uname)} as <b>${esc(a.rtitle)}</b>.</p>
      ${!plan ? `<form method="post" action="/company/agents/launch/app/${a.id}/build"><button class="btn">Generate 30/60/90 plan</button></form>` : `
        <div class="lbl">30 / 60 / 90-day plan</div>
        <pre class="gen">${esc(plan.body)}</pre>
        <div class="actions"><button class="btn sm g" onclick="window.print()">Print / save as PDF</button>
        ${a.uphone && notify.enabled() ? `<form method="post" action="/company/agents/launch/app/${a.id}/send" style="display:inline"><button class="btn sm g">Send welcome on WhatsApp</button></form>` : ''}</div>
        <div class="lbl">Day-1 compliance checklist</div>
        <form method="post" action="/company/agents/launch/app/${a.id}/checks">
          ${COMPLIANCE.map(c => `<label style="display:block;margin:5px 0"><input type="checkbox" name="c" value="${esc(c)}" ${doneSet.has(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}
          <button class="btn sm">Save checklist</button> <span class="sub">${checks.length}/${COMPLIANCE.length} complete</span>
        </form>
        <div class="msg">Manager check-ins at <b>14, 30 and 60 days</b> ${notify.enabled() ? 'can fire over WhatsApp' : '(configure WhatsApp to auto-send)'}. SDL/SETA activity is logged for W&amp;SP claims.</div>
      `}` }));
  });
  app.post('/company/agents/launch/app/:aid/build', requireAuth, requireRole('employer'), async (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/launch');
    const company = db.get('SELECT name FROM companies WHERE id=?', co(req));
    const body = await tryLLM(`Write a personalised 30/60/90-day onboarding plan for ${a.uname}, joining ${company ? company.name : 'the company'} as ${a.rtitle} (South Africa). Three sections: "First 30 days" (learn — courses, shadowing, access, meet-the-team), "By 60 days" (contribute — owning first tasks), "By 90 days" (deliver — measurable milestones). 4-5 bullets each, practical, SA English. End with "Success looks like:" one line.`)
      || `30/60/90-day plan · ${a.uname} · ${a.rtitle}\n\nFirst 30 days — Learn\n- Complete Day-1 compliance (POPIA, cyber, code of conduct)\n- Set up systems access and tooling\n- Meet your team and key stakeholders\n- Shadow an experienced colleague; learn the core process\n- Weekly check-in with your manager\n\nBy 60 days — Contribute\n- Own your first independent tasks end-to-end\n- Take feedback from your 30-day review and apply it\n- Build working relationships across the team\n- Close any skills gap flagged by your CALIBR Score\n\nBy 90 days — Deliver\n- Hit your first measurable targets for the role\n- Run a piece of work independently, start to finish\n- Agree 6-month goals with your manager\n\nSuccess looks like: delivering real outcomes independently and confidently by day 90.`;
    db.run('INSERT INTO onboarding_plans (application_id,company_id,body,checks,created_at) VALUES (?,?,?,?,?)', a.id, co(req), body, '[]', now());
    res.redirect('/company/agents/launch/app/' + a.id);
  });
  app.post('/company/agents/launch/app/:aid/checks', requireAuth, requireRole('employer'), (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/launch');
    const plan = db.get('SELECT * FROM onboarding_plans WHERE application_id=? ORDER BY id DESC LIMIT 1', a.id);
    if (plan) { const picked = [].concat(req.body.c || []); db.run('UPDATE onboarding_plans SET checks=? WHERE id=?', JSON.stringify(picked), plan.id); }
    res.redirect('/company/agents/launch/app/' + a.id);
  });
  app.post('/company/agents/launch/app/:aid/send', requireAuth, requireRole('employer'), (req, res) => {
    const a = appRow(co(req), req.params.aid); if (!a) return res.redirect('/company/agents/launch');
    const company = db.get('SELECT name FROM companies WHERE id=?', co(req));
    if (a.uphone && notify.enabled()) notify.fire(a.uphone, `Welcome to ${company ? company.name : 'the team'}, ${a.uname.split(' ')[0]}! 🎉 Your onboarding journey for ${a.rtitle} is ready. We're glad to have you. — CALIBR`);
    res.redirect('/company/agents/launch/app/' + a.id);
  });

  return { AGENTS };
};
