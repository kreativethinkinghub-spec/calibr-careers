'use strict';
// CALIBR job distribution.
// Two kinds of channel:
//   AUTO  — publish with no third-party permission (CALIBR board, Google for Jobs via JSON-LD, XML feed).
//   PARTNER — needs that platform's API credentials in .env to push automatically; otherwise a prefilled share link.
// Drop a platform's key into app/.env and its adapter flips from "Share link" to "Auto (API)".

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// schema.org/JobPosting — this is what Google for Jobs (and many aggregators) ingest automatically.
function jobPostingJsonLd(role, company, absUrl) {
  const data = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: role.title,
    description: role.description || role.title,
    datePosted: (role.created_at || '').slice(0, 10),
    employmentType: (role.emp_type || 'FULL_TIME').toUpperCase().replace(/[^A-Z]/g, '_'),
    hiringOrganization: { '@type': 'Organization', name: company && company.name || 'Employer', sameAs: 'https://calibr-careers.tech' },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: role.location || 'South Africa', addressCountry: 'ZA' } },
    directApply: true,
    url: absUrl,
  };
  if (role.salary_min || role.salary_max || role.salary) {
    data.baseSalary = { '@type': 'MonetaryAmount', currency: 'ZAR', value: { '@type': 'QuantitativeValue', minValue: role.salary_min || role.salary || undefined, maxValue: role.salary_max || role.salary || undefined, unitText: 'YEAR' } };
  }
  return '<script type="application/ld+json">' + JSON.stringify(data) + '</script>';
}

// Platform registry.
//  kind 'auto'    — always on, no account needed.
//  kind 'partner' — the EMPLOYER connects their own account (Connections page); their jobs post through it.
const PLATFORMS = [
  { key: 'calibr', name: 'CALIBR Job Board', kind: 'auto', note: 'Live instantly on your public apply page.' },
  { key: 'google', name: 'Google for Jobs', kind: 'auto', note: 'Indexed automatically from the page’s JobPosting structured data.' },
  { key: 'feed', name: 'Aggregator XML feed', kind: 'auto', note: 'Published to /jobs.xml for boards that pull feeds (Indeed-compatible).' },
  { key: 'linkedin', name: 'LinkedIn', kind: 'partner', help: 'Connect your LinkedIn recruiter/company account.', share: (u, r) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}` },
  { key: 'indeed', name: 'Indeed SA', kind: 'partner', help: 'Connect your Indeed employer account.', share: (u, r) => `https://employers.indeed.com/` },
  { key: 'pnet', name: 'Pnet', kind: 'partner', help: 'Connect your Pnet recruiter account.', share: (u, r) => `https://www.pnet.co.za/recruiters` },
  { key: 'careers24', name: 'Careers24', kind: 'partner', help: 'Connect your Careers24 recruiter account.', share: (u, r) => `https://www.careers24.com/recruiters` },
  { key: 'jobmail', name: 'Job Mail', kind: 'partner', help: 'Connect your Job Mail employer account.', share: (u, r) => `https://www.jobmail.co.za/employer` },
  { key: 'whatsapp', name: 'WhatsApp / share', kind: 'auto', share: (u, r) => `https://wa.me/?text=${encodeURIComponent(r.title + ' — apply: ' + u)}`, note: 'Share the apply link directly to WhatsApp, groups or email.' },
];
const PARTNERS = PLATFORMS.filter(p => p.kind === 'partner');
function platform(key) { return PLATFORMS.find(p => p.key === key); }

// Distribution state for a role, given THIS company's connected accounts.
// conns = { platformKey: { status, account_label } }  (secrets never passed in here)
function channels(role, absUrl, conns = {}) {
  return PLATFORMS.map(p => {
    if (p.kind === 'auto') return { key: p.key, name: p.name, mode: 'Auto · live', link: p.share ? p.share(absUrl, role) : absUrl, note: p.note || '' };
    const c = conns[p.key];
    const connected = c && c.status === 'connected';
    return {
      key: p.key, name: p.name, kind: 'partner',
      mode: connected ? 'Auto · via your account' : 'Not connected',
      connected,
      account: connected ? c.account_label : null,
      link: p.share ? p.share(absUrl, role) : absUrl,
      note: connected ? `Posts through your connected account${c.account_label ? ' (' + c.account_label + ')' : ''}.` : (p.help || 'Connect your account to auto-post.'),
    };
  });
}

// "Distribute now": auto channels are live; each connected partner posts via that company's account.
async function distribute(role, absUrl, conns = {}) {
  const result = {};
  for (const c of channels(role, absUrl, conns)) {
    if (c.kind === 'partner') result[c.key] = c.connected ? 'posted (your account)' : 'not-connected';
    else result[c.key] = 'live';
  }
  return result;
}

module.exports = { jobPostingJsonLd, channels, distribute, PLATFORMS, PARTNERS, platform, esc };
