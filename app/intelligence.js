'use strict';
// AI copilots (JD writer, CV summary, interview kit, feedback) + a deterministic
// bias / adverse-impact auditor (EEOC 4/5ths rule) — CALIBR's trust differentiator.
module.exports = function registerIntelligence(ctx) {
  const { app, db, shell, esc, now, requireAuth, requireRole, ai } = ctx;
  const E = requireRole('employer');
  const back = (href, label) => `<p class="sub"><a href="${href}" style="color:var(--pink);font-weight:700">&larr; ${esc(label)}</a></p>`;
  const aiTag = used => used ? '<span class="pill done">AI</span>' : `<span class="pill todo">Template</span> <span class="sub">add an API key in Render for AI-written output</span>`;
  const pre = t => `<div class="q" style="white-space:pre-wrap;font-size:13.5px;line-height:1.6">${esc(t)}</div>`;
  function criteriaFor(roleId) { const r = db.get('SELECT criteria FROM scorecards WHERE role_id=?', roleId); if (r && r.criteria) { try { const c = JSON.parse(r.criteria); if (Array.isArray(c) && c.length) return c; } catch (e) {} } return null; }
  function ownApp(id, cid) { return db.get('SELECT a.*, u.name, r.title, r.company_id FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN users u ON u.id=a.user_id WHERE a.id=?', id); }

  // ---------- AI JD writer ----------
  app.get('/company/jd', requireAuth, E, (req, res) => {
    res.send(shell({ title: 'AI JD writer', user: req.user, body: `
      <h1>AI job-description writer<em>.</em></h1>
      <p class="sub">Describe the role in a line — CALIBR drafts an inclusive, evidence-led JD you can edit and post. ${ai.hasKey() ? 'Powered by ' + esc(ai.provider()) + '.' : 'Works now via template; add an API key in Render for AI-written copy.'}</p>
      <form method="post" action="/company/jd">
        <div class="fld"><label>Role title</label><input name="title" required placeholder="e.g. Sales Manager"></div>
        <div class="fld inline">
          <div style="flex:1"><label>Seniority</label><input name="seniority" placeholder="e.g. Mid / Senior"></div>
          <div style="flex:1"><label>Location</label><input name="location" placeholder="e.g. Johannesburg"></div>
          <div style="flex:1"><label>Type</label><input name="emp_type" value="Full-time"></div>
        </div>
        <div class="fld"><label>Key skills (comma-separated)</label><input name="skills" placeholder="CRM, Excel, negotiation, POPIA"></div>
        <button class="btn">Draft the JD</button>
      </form>` }));
  });
  app.post('/company/jd', requireAuth, E, async (req, res) => {
    const co = db.get('SELECT name FROM companies WHERE id=?', req.user.company_id) || {};
    const out = await ai.writeJD({ title: req.body.title, seniority: req.body.seniority, skills: req.body.skills, location: req.body.location, emp_type: req.body.emp_type, company: co.name });
    res.send(shell({ title: 'JD draft', user: req.user, body: `
      <h1>Draft JD<em>.</em></h1>${back('/company/jd', 'Write another')} ${aiTag(out.ai)}
      <p class="sub">Edit anything, then post it — this pre-fills a live role.</p>
      <form method="post" action="/company/role">
        <div class="fld"><label>Title</label><input name="title" value="${esc(req.body.title || '')}" required></div>
        <div class="fld inline">
          <div style="flex:1"><label>Location</label><input name="location" value="${esc(req.body.location || '')}"></div>
          <div style="flex:1"><label>Type</label><input name="emp_type" value="${esc(req.body.emp_type || 'Full-time')}"></div>
        </div>
        <div class="fld inline">
          <div style="flex:1"><label>Salary min (ZAR/yr)</label><input name="salary_min" type="number"></div>
          <div style="flex:1"><label>Salary max (ZAR/yr)</label><input name="salary_max" type="number"></div>
        </div>
        <div class="fld"><label>Description</label><textarea name="description" style="min-height:320px">${esc(out.text)}</textarea></div>
        <button class="btn">Post this role</button>
      </form>` }));
  });

  // ---------- AI CV summary ----------
  app.get('/company/app/:id/summary', requireAuth, E, async (req, res) => {
    const a = ownApp(req.params.id, req.user.company_id); if (!a || a.company_id !== req.user.company_id) return res.redirect('/company');
    const out = await ai.summariseCV(a.cv_text, a.title);
    res.send(shell({ title: 'CV summary', user: req.user, body: `
      <h1>CV summary · ${esc(a.name)}<em>.</em></h1>${back('/company/app/' + a.id, 'Back to candidate')} ${aiTag(out.ai)}
      ${pre(out.text)}
      <p class="sub" style="font-size:12px">Generated from the submitted CV only. Verify claims in interview — do not treat as fact.</p>` }));
  });

  // ---------- AI interview kit ----------
  app.get('/company/app/:id/questions', requireAuth, E, async (req, res) => {
    const a = ownApp(req.params.id, req.user.company_id); if (!a || a.company_id !== req.user.company_id) return res.redirect('/company');
    const out = await ai.interviewQuestions({ title: a.title, criteria: criteriaFor(a.role_id) });
    res.send(shell({ title: 'Interview kit', user: req.user, body: `
      <h1>Interview kit · ${esc(a.title)}<em>.</em></h1>${back('/company/app/' + a.id, 'Back to candidate')} ${aiTag(out.ai)}
      <p class="sub">Structured, behavioural questions aligned to this role's scorecard. Ask every candidate the same set — that's what makes it defensible.</p>
      ${pre(out.text)}
      <div class="actions"><a class="btn sm" href="/company/app/${a.id}/review">Score this candidate</a></div>` }));
  });

  // ---------- AI structured feedback ----------
  app.post('/company/app/:id/feedback', requireAuth, E, async (req, res) => {
    const a = ownApp(req.params.id, req.user.company_id); if (!a || a.company_id !== req.user.company_id) return res.redirect('/company');
    const out = await ai.structureFeedback(req.body.notes, req.body.rec);
    res.send(shell({ title: 'Feedback', user: req.user, body: `
      <h1>Structured feedback · ${esc(a.name)}<em>.</em></h1>${back('/company/app/' + a.id, 'Back to candidate')} ${aiTag(out.ai)}
      ${pre(out.text)}
      <p class="sub">Copy this into your scorecard notes.</p>` }));
  });

  // ---------- Bias / adverse-impact auditor (4/5ths rule) ----------
  app.get('/company/audit', requireAuth, E, (req, res) => {
    const rows = db.all(`SELECT u.ee_race, u.ee_gender, a.stage FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN users u ON u.id=a.user_id WHERE r.company_id=?`, req.user.company_id);
    const ADV = new Set(['Shortlist', 'Interview', 'Offer', 'Hired']);
    function analyse(attr) {
      const g = {};
      rows.forEach(r => { const k = r[attr] || 'Not disclosed'; (g[k] = g[k] || { applied: 0, adv: 0 }); g[k].applied++; if (ADV.has(r.stage)) g[k].adv++; });
      const groups = Object.entries(g).filter(([k]) => k !== 'Not disclosed').map(([k, v]) => ({ k, ...v, rate: v.applied ? v.adv / v.applied : 0 }));
      const maxRate = Math.max(0, ...groups.map(x => x.rate));
      groups.forEach(x => { x.ratio = maxRate ? x.rate / maxRate : null; x.flag = x.ratio != null && x.ratio < 0.8 && x.applied >= 5; });
      return { groups, nd: g['Not disclosed'] ? g['Not disclosed'].applied : 0, total: rows.length };
    }
    const tbl = (title, data) => `
      <div class="lbl">${esc(title)}</div>
      ${data.groups.length ? `<div class="table-wrap"><table><tr><th>Group</th><th>Applied</th><th>Advanced</th><th>Selection rate</th><th>Impact ratio</th><th>4/5ths</th></tr>
      ${data.groups.sort((a, b) => b.rate - a.rate).map(x => `<tr><td><b>${esc(x.k)}</b></td><td>${x.applied}</td><td>${x.adv}</td><td>${Math.round(x.rate * 100)}%</td><td>${x.ratio != null ? x.ratio.toFixed(2) : '—'}</td><td>${x.applied < 5 ? '<span class="sub">n&lt;5</span>' : x.flag ? '<span class="pill" style="background:#c33;color:#fff">Adverse impact</span>' : '<span class="pill done">OK</span>'}</td></tr>`).join('')}
      </table></div>${data.nd ? `<p class="sub" style="font-size:12px">${data.nd} applicant(s) did not disclose — excluded from ratios (POPIA: disclosure is optional).</p>` : ''}` : '<p class="sub">Not enough disclosed data yet.</p>'}`;
    const race = analyse('ee_race'), gender = analyse('ee_gender');
    const flagged = race.groups.some(x => x.flag) || gender.groups.some(x => x.flag);
    res.send(shell({ title: 'Fairness audit', user: req.user, body: `
      <h1>Fairness &amp; adverse-impact audit<em>.</em></h1>
      <p class="sub">Selection rates across your pipeline by Employment-Equity group, with the EEOC <b>4/5ths (80%) rule</b>. A group selected at under 80% of the top group's rate is flagged for review.</p>
      ${flagged ? '<div class="msg" style="border-left-color:#c33"><b>Potential adverse impact detected.</b> This is a screening signal, not proof of bias — investigate the roles and criteria driving it before it affects hiring.</div>' : '<div class="msg">No adverse-impact flags at the current sample. Keep monitoring as volume grows.</div>'}
      ${tbl('By race (advanced past application)', race)}
      ${tbl('By gender (advanced past application)', gender)}
      <p class="sub" style="font-size:12px">"Advanced" = reached Shortlist, Interview, Offer or Hired. Ratios need n≥5 to be meaningful. This tool supports fair, valid selection under the Employment Equity Act s8 — and should be reviewed by a suitably qualified person before it drives decisions. <a href="/methodology" style="color:var(--pink);font-weight:700">Methodology &rarr;</a></p>` }));
  });
};
