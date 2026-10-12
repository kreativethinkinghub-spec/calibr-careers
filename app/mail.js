'use strict';
// Thin client for KTH Mail — CALIBR's messaging goes through Karli's own API.
// Configure in .env:  KTH_MAIL_URL=http://localhost:5300   KTH_MAIL_API_KEY=calibr_live_...
// If unset, calls are logged (dev) so signup still works without the mail service running.
const URL = (process.env.KTH_MAIL_URL || '').replace(/\/$/, '');
const KEY = process.env.KTH_MAIL_API_KEY || '';

async function post(path, body) {
  if (!URL) { console.log('[calibr→kth-mail] not configured; would send', path, JSON.stringify(body).slice(0, 160)); return { ok: false, dev: true }; }
  try {
    const r = await fetch(URL + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, KEY ? { 'x-api-key': KEY } : {}), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return Object.assign({ ok: true }, j);
  } catch (e) { console.error('[calibr→kth-mail] send failed:', e.message); return { ok: false, error: e.message }; }
}

const sendEmail = (to, template, vars, idempotency_key) => post('/v1/send', { to, template, vars, idempotency_key });
const sendSms = (to, template, vars, idempotency_key) => post('/v1/sms/send', { to, template, vars, idempotency_key });
const configured = () => !!URL;

module.exports = { sendEmail, sendSms, configured };
