'use strict';
// Minimal server-side templating — wraps content in the CALIBR app shell.
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function shell({ title = 'CALIBR', user = null, body = '', head = '' }) {
  const nav = `
  <header class="nav">
    <a class="logo" href="/"><span class="mark"><i></i></span>Calibr<em>.</em></a>
    <div class="nav-r">
      ${user ? `
        ${user.role === 'seeker' ? '<a href="/app">Dashboard</a>' : ''}
        ${user.role === 'employer' ? '<a href="/company">Dashboard</a>' : ''}
        ${user.role === 'partner' ? '<a href="/partner">Partner</a>' : ''}
        ${user.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}
        <span class="who">${esc(user.name)} · ${esc(user.role)}</span>
        <form method="post" action="/logout" style="display:inline"><button class="btn sm g">Sign out</button></form>
      ` : `
        <a href="https://calibr-careers.tech" target="_blank">Site</a>
        <a href="/login">Sign in</a>
        <a class="btn sm" href="/signup">Get started</a>
      `}
    </div>
  </header>`;
  return `<!DOCTYPE html><html lang="en-ZA"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} — CALIBR</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><line x1='20' y1='3' x2='20' y2='37' stroke='%23000000' stroke-width='2'/><line x1='3' y1='20' x2='37' y2='20' stroke='%23000000' stroke-width='2'/><circle cx='20' cy='20' r='14' fill='none' stroke='%23000000' stroke-width='3'/><circle cx='20' cy='20' r='7' fill='none' stroke='%23000000' stroke-width='3'/><circle cx='20' cy='20' r='3.5' fill='%23FF1F70'/></svg>">
  <link rel="stylesheet" href="/css/app.css">${head || ''}</head><body>
  ${nav}
  <main><div class="wrap">${body}</div></main>
  <div class="foot">CALIBR · a product of KTH-Tech · Reg 2025/627290/07 · POPIA-first · <a href="/methodology" style="color:var(--pink);font-weight:700">Methodology &amp; evidence</a></div>
  </body></html>`;
}
module.exports = { shell, esc };
