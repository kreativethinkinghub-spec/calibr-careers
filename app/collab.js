'use strict';
// Public per-company careers page + internal candidate comment threads (team collaboration).
module.exports = function registerCollab(ctx) {
  const { app, db, shell, esc, now, requireAuth, requireRole } = ctx;
  const E = requireRole('employer');

  // ---------- Public careers page: /careers/<companyId> ----------
  app.get('/careers/:cid', (req, res) => {
    const co = db.get('SELECT id, name FROM companies WHERE id=?', req.params.cid);
    if (!co) return res.redirect('/jobs');
    const roles = db.all("SELECT * FROM roles_posted WHERE company_id=? AND status='open' AND is_public=1 ORDER BY id DESC", co.id);
    res.send(shell({ title: co.name + ' — Careers', user: null, body: `
      <div class="eyebrow" style="color:var(--pink);font-weight:800;letter-spacing:.2em;text-transform:uppercase;font-size:11px">Careers</div>
      <h1>${esc(co.name)}<em>.</em></h1>
      <p class="sub">Open roles — apply and your CV is scored against the job the moment you submit. Powered by CALIBR.</p>
      ${roles.length ? `<div class="table-wrap"><table><tr><th>Role</th><th>Location</th><th>Type</th><th></th></tr>
      ${roles.map(r => `<tr><td><b>${esc(r.title)}</b></td><td>${esc(r.location || '—')}</td><td>${esc(r.emp_type || 'Full-time')}</td><td>${r.public_token ? `<a class="btn sm" href="/jobs/${r.public_token}">View &amp; apply</a>` : '<span class="sub">draft</span>'}</td></tr>`).join('')}
      </table></div>` : '<p class="sub">No open roles right now — check back soon.</p>'}
      <p class="sub" style="margin-top:24px;font-size:12px">Hiring on evidence with <a href="/" style="color:var(--pink);font-weight:700">CALIBR</a> · POPIA-first · priced in Rand.</p>` }));
  });

  // ---------- Candidate comments (team collaboration) ----------
  app.post('/company/app/:id/comment', requireAuth, E, (req, res) => {
    const a = db.get('SELECT a.id, r.company_id FROM applications a JOIN roles_posted r ON r.id=a.role_id WHERE a.id=?', req.params.id);
    if (!a || a.company_id !== req.user.company_id) return res.redirect('/company');
    const body = (req.body.body || '').trim().slice(0, 2000);
    if (body) db.run('INSERT INTO comments (application_id,author_id,author_name,body,created_at) VALUES (?,?,?,?,?)', a.id, req.user.id, req.user.name, body, now());
    res.redirect('/company/app/' + a.id + '#comments');
  });

  // rendered into the applicant detail page
  function commentsHtml(appId) {
    const rows = db.all('SELECT * FROM comments WHERE application_id=? ORDER BY id ASC', appId);
    return `
    <div class="lbl" id="comments">Team notes${rows.length ? ' (' + rows.length + ')' : ''}</div>
    ${rows.length ? rows.map(c => `<div class="q" style="margin-bottom:8px"><b>${esc(c.author_name || 'Teammate')}</b> <span class="sub" style="font-size:11px">${esc((c.created_at || '').slice(0, 16).replace('T', ' '))}</span><div style="margin-top:4px;white-space:pre-wrap">${esc(c.body)}</div></div>`).join('') : '<p class="sub">No notes yet — leave the first for your team.</p>'}
    <form method="post" action="/company/app/${appId}/comment" style="margin-top:8px">
      <div class="fld"><textarea name="body" required placeholder="Add a note for your hiring team…" style="min-height:70px"></textarea></div>
      <button class="btn sm">Post note</button>
    </form>`;
  }

  return { commentsHtml };
};
