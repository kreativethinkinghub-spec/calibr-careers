'use strict';
// Employer hiring toolkit: structured scorecards / interview kits, interview
// scheduling, and pipeline analytics. Registers its own routes and returns a
// helper that renders the per-applicant add-ons for the applicant detail page.
module.exports = function registerHiring(ctx) {
  const { app, db, shell, esc, now, requireAuth, requireRole, STAGES } = ctx;
  const E = requireRole('employer');

  const DEFAULT_CRITERIA = [
    { name: 'Skills & technical ability', weight: 30 },
    { name: 'Relevant experience', weight: 25 },
    { name: 'Problem-solving', weight: 15 },
    { name: 'Communication', weight: 15 },
    { name: 'Culture & values fit', weight: 15 },
  ];
  const RECS = { strong_yes: 'Strong yes', yes: 'Yes', no: 'No', strong_no: 'Strong no' };
  const RATE = ['', 'Poor', 'Weak', 'OK', 'Strong', 'Excellent'];

  function criteriaFor(roleId) {
    const r = db.get('SELECT criteria FROM scorecards WHERE role_id=?', roleId);
    if (r && r.criteria) { try { const c = JSON.parse(r.criteria); if (Array.isArray(c) && c.length) return c; } catch (e) {} }
    return DEFAULT_CRITERIA;
  }
  function ownRole(id, cid) { return db.get('SELECT * FROM roles_posted WHERE id=? AND company_id=?', id, cid); }
  function ownApp(id, cid) { return db.get('SELECT a.*, u.name, r.title, r.company_id FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN users u ON u.id=a.user_id WHERE a.id=?', id); }

  // ---------- Scorecard definition (per role) ----------
  app.get('/company/role/:id/scorecard', requireAuth, E, (req, res) => {
    const role = ownRole(req.params.id, req.user.company_id); if (!role) return res.redirect('/company');
    const crit = criteriaFor(role.id);
    const rows = Array.from({ length: 8 }, (_, i) => {
      const c = crit[i] || { name: '', weight: '' };
      return `<div class="fld inline"><div style="flex:3"><label>Criterion ${i + 1}</label><input name="name_${i}" value="${esc(c.name || '')}" placeholder="e.g. Domain expertise"></div><div style="flex:1"><label>Weight</label><input name="weight_${i}" type="number" min="0" max="100" value="${c.weight === '' ? '' : c.weight}"></div></div>`;
    }).join('');
    res.send(shell({ title: 'Scorecard', user: req.user, body: `
      <h1>Interview scorecard<em>.</em></h1>
      <p class="sub"><a href="/company/role/${role.id}" style="color:var(--pink);font-weight:700">&larr; ${esc(role.title)}</a> · define what every interviewer rates candidates on. Weights are relative — they don't have to total 100.</p>
      <form method="post" action="/company/role/${role.id}/scorecard">${rows}
        <p class="sub">Leave a criterion blank to drop it. Blank scorecard falls back to the CALIBR default set.</p>
        <button class="btn">Save scorecard</button>
      </form>` }));
  });
  app.post('/company/role/:id/scorecard', requireAuth, E, (req, res) => {
    const role = ownRole(req.params.id, req.user.company_id); if (!role) return res.redirect('/company');
    const crit = [];
    for (let i = 0; i < 8; i++) { const n = (req.body['name_' + i] || '').trim(); const w = parseInt(req.body['weight_' + i], 10); if (n) crit.push({ name: n.slice(0, 80), weight: isNaN(w) ? 10 : Math.max(0, Math.min(100, w)) }); }
    const payload = JSON.stringify(crit.length ? crit : DEFAULT_CRITERIA);
    const ex = db.get('SELECT id FROM scorecards WHERE role_id=?', role.id);
    if (ex) db.run('UPDATE scorecards SET criteria=? WHERE role_id=?', payload, role.id);
    else db.run('INSERT INTO scorecards (role_id,criteria,created_at) VALUES (?,?,?)', role.id, payload, now());
    res.redirect('/company/role/' + role.id);
  });

  // ---------- Score a candidate against the rubric ----------
  app.get('/company/app/:id/review', requireAuth, E, (req, res) => {
    const a = ownApp(req.params.id, req.user.company_id); if (!a || a.company_id !== req.user.company_id) return res.redirect('/company');
    const crit = criteriaFor(a.role_id);
    res.send(shell({ title: 'Review', user: req.user, body: `
      <h1>Score · ${esc(a.name)}<em>.</em></h1>
      <p class="sub"><a href="/company/app/${a.id}" style="color:var(--pink);font-weight:700">&larr; Back</a> · ${esc(a.title)} · rate each criterion 1–5.</p>
      <form method="post" action="/company/app/${a.id}/review">
        <div class="fld"><label>Your name</label><input name="reviewer" value="${esc(req.user.name || '')}"></div>
        ${crit.map((c, i) => `<div class="fld"><label>${esc(c.name)} <span class="sub">· weight ${c.weight}</span></label><select name="r_${i}">${[3, 1, 2, 4, 5].map(n => `<option value="${n}"${n === 3 ? ' selected' : ''}>${n} — ${RATE[n]}</option>`).join('')}</select></div>`).join('')}
        <div class="fld"><label>Overall recommendation</label><select name="rec">${Object.entries(RECS).map(([k, v]) => `<option value="${k}"${k === 'yes' ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="fld"><label>Notes (evidence for your rating)</label><textarea name="notes" style="min-height:100px" placeholder="What did they demonstrate? Be specific."></textarea></div>
        <button class="btn">Submit scorecard</button>
      </form>` }));
  });
  app.post('/company/app/:id/review', requireAuth, E, (req, res) => {
    const a = ownApp(req.params.id, req.user.company_id); if (!a || a.company_id !== req.user.company_id) return res.redirect('/company');
    const crit = criteriaFor(a.role_id);
    let tot = 0, wsum = 0; const ratings = {};
    crit.forEach((c, i) => { const v = Math.max(1, Math.min(5, parseInt(req.body['r_' + i], 10) || 3)); ratings[c.name] = v; tot += (v / 5) * 100 * (c.weight || 0); wsum += (c.weight || 0); });
    const overall = wsum ? Math.round(tot / wsum) : 0;
    const rec = RECS[req.body.rec] ? req.body.rec : 'yes';
    db.run('INSERT INTO scorecard_reviews (application_id,reviewer,ratings,overall,recommendation,notes,created_at) VALUES (?,?,?,?,?,?,?)',
      a.id, (req.body.reviewer || '').slice(0, 80) || req.user.name, JSON.stringify(ratings), overall, rec, (req.body.notes || '').slice(0, 2000), now());
    res.redirect('/company/app/' + a.id);
  });

  // ---------- Schedule an interview ----------
  app.post('/company/app/:id/schedule', requireAuth, E, (req, res) => {
    const a = ownApp(req.params.id, req.user.company_id); if (!a || a.company_id !== req.user.company_id) return res.redirect('/company');
    const when = (req.body.when_at || '').slice(0, 40), mode = ['video', 'in-person', 'phone'].includes(req.body.mode) ? req.body.mode : 'video', loc = (req.body.location || '').slice(0, 300);
    if (when) db.run('INSERT INTO interview_slots (application_id,company_id,when_at,mode,location,status,created_at) VALUES (?,?,?,?,?,?,?)', a.id, req.user.company_id, when, mode, loc, 'scheduled', now());
    res.redirect('/company/app/' + a.id);
  });
  app.post('/company/interview/:sid/cancel', requireAuth, E, (req, res) => {
    const s = db.get('SELECT * FROM interview_slots WHERE id=? AND company_id=?', req.params.sid, req.user.company_id);
    if (s) db.run('UPDATE interview_slots SET status=? WHERE id=?', 'cancelled', s.id);
    res.redirect('/company/app/' + (s ? s.application_id : ''));
  });

  // ---------- Pipeline analytics ----------
  app.get('/company/analytics', requireAuth, E, (req, res) => {
    const cid = req.user.company_id;
    const apps = db.all('SELECT a.stage, a.source, a.jd_match, a.created_at, a.hired_at FROM applications a JOIN roles_posted r ON r.id=a.role_id WHERE r.company_id=?', cid);
    const funnel = {}; STAGES.forEach(s => funnel[s] = 0); apps.forEach(a => { if (funnel[a.stage] != null) funnel[a.stage]++; });
    const total = apps.length;
    const bySource = {}; apps.forEach(a => { const s = a.source || 'other'; bySource[s] = (bySource[s] || 0) + 1; });
    const hires = apps.filter(a => a.stage === 'Hired');
    const tth = hires.filter(a => a.hired_at && a.created_at).map(a => (new Date(a.hired_at) - new Date(a.created_at)) / 86400000).filter(d => d >= 0);
    const avgTth = tth.length ? Math.round(tth.reduce((x, y) => x + y, 0) / tth.length) : null;
    const matched = apps.filter(a => a.jd_match != null);
    const avgMatch = matched.length ? Math.round(matched.reduce((s, a) => s + a.jd_match, 0) / matched.length) : null;
    const openRoles = db.get("SELECT COUNT(*) n FROM roles_posted WHERE company_id=? AND status='open'", cid).n;
    const reviews = db.get('SELECT COUNT(*) n FROM scorecard_reviews sr JOIN applications a ON a.id=sr.application_id JOIN roles_posted r ON r.id=a.role_id WHERE r.company_id=?', cid).n;
    const fmax = Math.max(1, ...Object.values(funnel));
    const bar = (n) => `<div style="background:var(--paper2,#f2f2f2);border-radius:6px;overflow:hidden;height:20px;min-width:60px"><span style="display:block;height:100%;width:${Math.round(n / fmax * 100)}%;background:var(--pink)"></span></div>`;
    res.send(shell({ title: 'Analytics', user: req.user, body: `
      <h1>Hiring analytics<em>.</em></h1>
      <p class="sub">Your pipeline at a glance — funnel, time-to-hire, source quality and interview coverage.</p>
      <div class="grid">
        <div class="card"><h3>${total}</h3><p>Total applicants</p></div>
        <div class="card"><h3>${hires.length}</h3><p>Hires made</p></div>
        <div class="card"><h3>${avgTth != null ? avgTth + '<span style="font-size:14px"> days</span>' : '—'}</h3><p>Avg time-to-hire</p></div>
        <div class="card"><h3>${openRoles}</h3><p>Open roles</p></div>
        <div class="card"><h3>${avgMatch != null ? avgMatch + '%' : '—'}</h3><p>Avg JD match</p></div>
        <div class="card"><h3>${reviews}</h3><p>Scorecards submitted</p></div>
      </div>
      <div class="lbl">Pipeline funnel</div>
      <div class="table-wrap"><table><tr><th>Stage</th><th>Count</th><th style="width:55%">Share</th></tr>
      ${STAGES.map(s => `<tr><td><b>${s}</b></td><td>${funnel[s]}</td><td>${bar(funnel[s])}</td></tr>`).join('')}</table></div>
      <div class="lbl">Source quality — where applicants come from</div>
      <div class="table-wrap"><table><tr><th>Source</th><th>Applicants</th></tr>
      ${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<tr><td>${esc(s)}</td><td><b>${n}</b></td></tr>`).join('') || '<tr><td colspan="2" class="sub">No applicants yet.</td></tr>'}</table></div>
      <p class="sub" style="font-size:12px">Time-to-hire is measured from application to the "Hired" stage. Source: pool = screened from the CALIBR pool, public = applied via your job link, bulk = uploaded CV batch.</p>` }));
  });

  // ---------- per-applicant add-ons (rendered inside /company/app/:id) ----------
  function applicantExtras(appId, roleId) {
    const crit = criteriaFor(roleId);
    const reviews = db.all('SELECT * FROM scorecard_reviews WHERE application_id=? ORDER BY id DESC', appId);
    const slots = db.all("SELECT * FROM interview_slots WHERE application_id=? AND status!='cancelled' ORDER BY when_at ASC", appId);
    const consensus = reviews.length ? Math.round(reviews.reduce((s, r) => s + (r.overall || 0), 0) / reviews.length) : null;
    const reviewsHtml = reviews.length ? `<div class="table-wrap"><table><tr><th>Reviewer</th><th>Overall</th><th>Recommendation</th><th>Notes</th></tr>
      ${reviews.map(r => `<tr><td><b>${esc(r.reviewer || '—')}</b></td><td><b style="color:var(--pink)">${r.overall}%</b></td><td>${esc((RECS[r.recommendation] || r.recommendation || '').toString())}</td><td>${esc((r.notes || '').slice(0, 160))}</td></tr>`).join('')}</table></div>`
      : '<p class="sub">No scorecards yet.</p>';
    const slotsHtml = slots.length ? `<div class="table-wrap"><table><tr><th>When</th><th>Mode</th><th>Where / link</th><th></th></tr>
      ${slots.map(s => `<tr><td><b>${esc(s.when_at)}</b></td><td>${esc(s.mode)}</td><td>${esc(s.location || '—')}</td><td><form method="post" action="/company/interview/${s.id}/cancel" style="display:inline"><button class="btn sm g">Cancel</button></form></td></tr>`).join('')}</table></div>`
      : '<p class="sub">No interviews scheduled.</p>';
    return `
    <div class="lbl">Interview scorecards${consensus != null ? ` · consensus <span style="color:var(--pink)">${consensus}%</span> (${reviews.length})` : ''}</div>
    ${reviewsHtml}
    <div class="actions" style="margin-top:8px"><a class="btn sm" href="/company/app/${appId}/review">＋ Score this candidate</a> <a class="btn sm g" href="/company/role/${roleId}/scorecard">Edit rubric</a></div>
    <div class="lbl">Interviews</div>
    ${slotsHtml}
    <form method="post" action="/company/app/${appId}/schedule" class="fld inline" style="margin-top:8px">
      <div style="flex:2"><label>Date &amp; time</label><input name="when_at" type="datetime-local"></div>
      <div style="flex:1"><label>Mode</label><select name="mode"><option value="video">Video</option><option value="in-person">In-person</option><option value="phone">Phone</option></select></div>
      <div style="flex:2"><label>Where / meeting link</label><input name="location" placeholder="Zoom link or address"></div>
      <div style="display:flex;align-items:flex-end"><button class="btn sm">Schedule</button></div>
    </form>`;
  }

  return { applicantExtras, criteriaFor };
};
