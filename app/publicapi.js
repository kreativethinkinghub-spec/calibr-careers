'use strict';
// Public REST API (per-company API keys) + outbound webhooks on new applications.
// Enterprise-grade integration surface — everything scoped to the calling company.
const crypto = require('crypto');
module.exports = function registerApi(ctx) {
  const { app, db, shell, esc, now, requireAuth, requireRole } = ctx;
  const E = requireRole('employer');

  // ---------- API-key auth middleware ----------
  function apiAuth(req, res, next) {
    const h = req.headers['authorization'] || '';
    const key = (h.startsWith('Bearer ') ? h.slice(7) : req.headers['x-api-key'] || '').trim();
    if (!key) return res.status(401).json({ error: 'missing API key' });
    const row = db.get('SELECT * FROM api_keys WHERE key=?', key);
    if (!row) return res.status(401).json({ error: 'invalid API key' });
    db.run('UPDATE api_keys SET last_used=? WHERE id=?', now(), row.id);
    req.companyId = row.company_id;
    next();
  }

  // ---------- management UI ----------
  app.get('/company/api', requireAuth, E, (req, res) => {
    const co = db.get('SELECT webhook_url FROM companies WHERE id=?', req.user.company_id) || {};
    const keys = db.all('SELECT * FROM api_keys WHERE company_id=? ORDER BY id DESC', req.user.company_id);
    const base = `${req.protocol}://${req.get('host')}`;
    res.send(shell({ title: 'API & webhooks', user: req.user, body: `
      <h1>API &amp; webhooks<em>.</em></h1>
      <p class="sub">Integrate CALIBR with your HRIS or tools. Keys are scoped to your company. Send them as <code>Authorization: Bearer &lt;key&gt;</code>.</p>
      <div class="lbl">Your API keys</div>
      ${keys.length ? `<div class="table-wrap"><table><tr><th>Label</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr>
      ${keys.map(k => `<tr><td>${esc(k.label || '—')}</td><td><code style="font-size:12px">${esc(k.key)}</code></td><td>${esc((k.created_at || '').slice(0, 10))}</td><td>${esc((k.last_used || '—').slice(0, 10))}</td><td><form method="post" action="/company/api/key/${k.id}/revoke" style="display:inline"><button class="btn sm g">Revoke</button></form></td></tr>`).join('')}
      </table></div>` : '<p class="sub">No keys yet.</p>'}
      <form method="post" action="/company/api/key" class="fld inline" style="margin-top:8px">
        <div style="flex:2"><label>New key label</label><input name="label" placeholder="e.g. HRIS sync"></div>
        <div style="display:flex;align-items:flex-end"><button class="btn sm">Generate key</button></div>
      </form>
      <div class="lbl">Webhook — new applications</div>
      <p class="sub">We POST a JSON event to this URL whenever a candidate applies.</p>
      <form method="post" action="/company/api/webhook" class="fld inline">
        <div style="flex:3"><label>Webhook URL</label><input name="webhook_url" value="${esc(co.webhook_url || '')}" placeholder="https://your-system.example/calibr-hook"></div>
        <div style="display:flex;align-items:flex-end"><button class="btn sm">Save</button></div>
      </form>
      <div class="lbl">Endpoints</div>
      <div class="q" style="font-size:13px;line-height:1.7"><code>GET ${esc(base)}/api/v1/roles</code> — your open roles<br>
      <code>GET ${esc(base)}/api/v1/applications</code> — applicants with fit, JD-match, stage &amp; CALIBR Score<br>
      <code>GET ${esc(base)}/api/v1/roles/:id/applications</code> — applicants for one role</div>` }));
  });
  app.post('/company/api/key', requireAuth, E, (req, res) => {
    const key = 'clbr_' + crypto.randomBytes(24).toString('hex');
    db.run('INSERT INTO api_keys (company_id,label,key,created_at) VALUES (?,?,?,?)', req.user.company_id, (req.body.label || '').slice(0, 60), key, now());
    res.redirect('/company/api');
  });
  app.post('/company/api/key/:id/revoke', requireAuth, E, (req, res) => {
    db.run('DELETE FROM api_keys WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
    res.redirect('/company/api');
  });
  app.post('/company/api/webhook', requireAuth, E, (req, res) => {
    const url = (req.body.webhook_url || '').trim().slice(0, 400) || null;
    if (url && !/^https?:\/\//i.test(url)) return res.redirect('/company/api');
    db.run('UPDATE companies SET webhook_url=? WHERE id=?', url, req.user.company_id);
    res.redirect('/company/api');
  });

  // ---------- REST endpoints (JSON) ----------
  app.get('/api/v1/roles', apiAuth, (req, res) => {
    const rows = db.all("SELECT id,title,location,emp_type,salary_min,salary_max,status,public_token,created_at FROM roles_posted WHERE company_id=? ORDER BY id DESC", req.companyId);
    res.json({ data: rows.map(r => ({ ...r, apply_url: r.public_token ? `${req.protocol}://${req.get('host')}/jobs/${r.public_token}` : null })) });
  });
  function appsFor(companyId, roleId) {
    const args = [companyId]; let sql = `SELECT a.id, a.role_id, r.title role_title, u.name candidate, u.email, a.stage, a.fit, a.jd_match, a.source, a.created_at, s.composite calibr_score
      FROM applications a JOIN roles_posted r ON r.id=a.role_id JOIN users u ON u.id=a.user_id
      LEFT JOIN scores s ON s.id=(SELECT MAX(id) FROM scores WHERE user_id=u.id)
      WHERE r.company_id=?`;
    if (roleId) { sql += ' AND a.role_id=?'; args.push(roleId); }
    return db.all(sql + ' ORDER BY a.fit DESC', ...args);
  }
  app.get('/api/v1/applications', apiAuth, (req, res) => res.json({ data: appsFor(req.companyId) }));
  app.get('/api/v1/roles/:id/applications', apiAuth, (req, res) => {
    const own = db.get('SELECT id FROM roles_posted WHERE id=? AND company_id=?', req.params.id, req.companyId);
    if (!own) return res.status(404).json({ error: 'role not found' });
    res.json({ data: appsFor(req.companyId, req.params.id) });
  });

  // ---------- outbound webhook (fire-and-forget) ----------
  function fireWebhook(companyId, event, payload) {
    try {
      const co = db.get('SELECT webhook_url FROM companies WHERE id=?', companyId);
      if (!co || !co.webhook_url) return;
      Promise.resolve(fetch(co.webhook_url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-calibr-event': event }, body: JSON.stringify({ event, at: now(), data: payload }) })).catch(() => {});
    } catch (e) {}
  }
  return { fireWebhook };
};
