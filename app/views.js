'use strict';
// Minimal server-side templating — wraps content in the CALIBR app shell.
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function shell({ title = 'CALIBR', user = null, body = '', head = '' }) {
  const nav = `
  <header class="nav">
    <a class="logo" href="/"><span class="mark"><i></i></span>Calibr<em>.</em></a>
    <div class="nav-r">
      ${user ? `
        ${user.role === 'seeker' ? '<a href="/app">Dashboard</a> <a href="/jobs">Jobs</a> <a href="/app/coaching">Coaching</a>' : ''}
        ${user.role === 'employer' ? '<a href="/company">Dashboard</a> <a href="/company/pool">Talent pool</a> <a href="/app/coaching">Coaching</a>' : ''}
        ${user.role === 'partner' ? '<a href="/partner">Partner</a>' : ''}
        ${user.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}
        <span class="who">${esc(user.name)}${user.email_verified ? ' <span title="Email verified" style="color:var(--pink);font-weight:900">✓</span>' : ''}</span>
        <form method="post" action="/logout" style="display:inline"><button class="btn sm g">Sign out</button></form>
      ` : `
        <a href="https://calibr-careers.tech" target="_blank">Site</a>
        <a href="/login">Sign in</a>
        <a class="btn sm" href="/signup">Get started</a>
      `}
    </div>
  </header>
  ${user && !user.email_verified ? `<div style="background:var(--pink);color:#fff;padding:9px 22px;font-size:13px;font-weight:600;text-align:center">Confirm your email to secure your account and get role alerts. <form method="post" action="/resend-verification" style="display:inline"><button style="background:none;border:none;color:#fff;text-decoration:underline;font:inherit;font-weight:800;cursor:pointer">Resend verification email</button></form></div>` : ''}`;
  return `<!DOCTYPE html><html lang="en-ZA"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} — CALIBR</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><line x1='20' y1='3' x2='20' y2='37' stroke='%23000000' stroke-width='2'/><line x1='3' y1='20' x2='37' y2='20' stroke='%23000000' stroke-width='2'/><circle cx='20' cy='20' r='14' fill='none' stroke='%23000000' stroke-width='3'/><circle cx='20' cy='20' r='7' fill='none' stroke='%23000000' stroke-width='3'/><circle cx='20' cy='20' r='3.5' fill='%23FF1F70'/></svg>">
  <link rel="stylesheet" href="/css/app.css"><script src="/js/cv-upload.js" defer></script>${head || ''}</head><body>
  ${nav}
  <main><div class="wrap">${body}</div></main>
  <div class="foot">CALIBR · a product of KTH-Tech · Reg 2025/627290/07 · POPIA-first · <a href="/methodology" style="color:var(--pink);font-weight:700">Methodology &amp; evidence</a><br>
    <a href="https://calibr-careers.tech/terms.html" target="_blank" rel="noopener">Terms</a> · <a href="https://calibr-careers.tech/privacy.html" target="_blank" rel="noopener">Privacy &amp; POPIA</a> · <a href="https://calibr-careers.tech/cookies.html" target="_blank" rel="noopener">Cookies</a> · <a href="https://calibr-careers.tech/acceptable-use.html" target="_blank" rel="noopener">Acceptable Use</a> · <a href="https://calibr-careers.tech/refund-policy.html" target="_blank" rel="noopener">Refunds</a> · <a href="https://calibr-careers.tech/sla.html" target="_blank" rel="noopener">SLA</a> · <a href="https://calibr-careers.tech/legal.html" target="_blank" rel="noopener" style="font-weight:700">All policies &amp; procedures</a></div>
  </body></html>`;
}
module.exports = { shell, esc };
