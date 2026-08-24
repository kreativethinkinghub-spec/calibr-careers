'use strict';
// Real OAuth 2.0 connector for employer platform accounts.
// A platform becomes "OAuth-ready" only when CALIBR's app credentials for it are in app/.env:
//   <PLATFORM>_CLIENT_ID and <PLATFORM>_CLIENT_SECRET
// Those credentials come from registering CALIBR as a developer/partner app on that platform
// (LinkedIn Talent Solutions, Indeed Employer API, etc.) — a step only the platform can grant.
// Until then, the manual token-paste connection remains the fallback.

const PROVIDERS = {
  linkedin: {
    name: 'LinkedIn',
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    // Job posting needs LinkedIn Talent partner scopes; profile scope is enough to prove the connection.
    scope: 'r_liteprofile',
    register: 'https://www.linkedin.com/developers/apps  (LinkedIn Talent Solutions partner for job posting)',
    idEnv: 'LINKEDIN_CLIENT_ID', secretEnv: 'LINKEDIN_CLIENT_SECRET',
  },
  indeed: {
    name: 'Indeed',
    authUrl: 'https://secure.indeed.com/oauth/v2/authorize',
    tokenUrl: 'https://apis.indeed.com/oauth/v2/tokens',
    scope: 'email offline_access',
    register: 'https://developer.indeed.com  (Indeed OAuth / Employer API)',
    idEnv: 'INDEED_CLIENT_ID', secretEnv: 'INDEED_CLIENT_SECRET',
  },
  // pnet / careers24 / jobmail: no public OAuth — manual connection only.
};

function provider(platform) { return PROVIDERS[platform] || null; }
function ready(platform) { const p = PROVIDERS[platform]; return !!(p && process.env[p.idEnv] && process.env[p.secretEnv]); }

function authorizeUrl(platform, redirectUri, state) {
  const p = PROVIDERS[platform]; if (!p) return null;
  const q = new URLSearchParams({ response_type: 'code', client_id: process.env[p.idEnv], redirect_uri: redirectUri, scope: p.scope, state });
  return p.authUrl + '?' + q.toString();
}

async function exchange(platform, code, redirectUri) {
  const p = PROVIDERS[platform]; if (!p) throw new Error('unknown platform');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: process.env[p.idEnv], client_secret: process.env[p.secretEnv] });
  const r = await fetch(p.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(p.name + ' token ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json(); // { access_token, refresh_token, expires_in, ... }
}

module.exports = { PROVIDERS, provider, ready, authorizeUrl, exchange };
