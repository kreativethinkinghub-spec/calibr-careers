'use strict';
// WhatsApp notifications — the SA-native channel. Sends via Meta WhatsApp Cloud API
// OR Twilio WhatsApp, whichever is configured in env. Fully inert (no-op) until keys
// are set, so nothing sends until you're ready. No SDK dependency — plain HTTPS.
//
//   Meta Cloud API:  WHATSAPP_TOKEN, WHATSAPP_PHONE_ID   (optional WHATSAPP_API_VERSION)
//   Twilio:          TWILIO_SID, TWILIO_TOKEN, TWILIO_WHATSAPP_FROM  (e.g. +14155238886)

function metaReady() { return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID); }
function twilioReady() { return !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_WHATSAPP_FROM); }
function enabled() { return metaReady() || twilioReady(); }
function provider() { return metaReady() ? 'WhatsApp Cloud API' : twilioReady() ? 'Twilio WhatsApp' : 'none'; }

// Normalise a SA/local number to E.164 (default country code +27 South Africa).
function e164(raw, cc = '27') {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (s.startsWith('0')) return '+' + cc + s.slice(1);   // 082... -> +2782...
  if (s.startsWith(cc)) return '+' + s;
  return '+' + cc + s;
}

async function send(to, message) {
  const num = e164(to);
  if (!num) return { ok: false, skipped: 'no-number' };
  if (!enabled()) return { ok: false, skipped: 'not-configured' };
  try {
    if (metaReady()) {
      const v = process.env.WHATSAPP_API_VERSION || 'v20.0';
      const r = await fetch(`https://graph.facebook.com/${v}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: num.replace('+', ''), type: 'text', text: { preview_url: true, body: message.slice(0, 4000) } }),
      });
      if (!r.ok) return { ok: false, error: 'meta ' + r.status + ' ' + (await r.text()).slice(0, 200) };
      return { ok: true, provider: 'meta' };
    }
    // Twilio
    const sid = process.env.TWILIO_SID, tok = process.env.TWILIO_TOKEN, from = process.env.TWILIO_WHATSAPP_FROM;
    const body = new URLSearchParams({ From: 'whatsapp:' + e164(from), To: 'whatsapp:' + num, Body: message.slice(0, 1500) });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64') },
      body: body.toString(),
    });
    if (!r.ok) return { ok: false, error: 'twilio ' + r.status + ' ' + (await r.text()).slice(0, 200) };
    return { ok: true, provider: 'twilio' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// Fire-and-forget helper so a slow/failed WhatsApp never blocks or breaks a request.
function fire(to, message) { try { Promise.resolve(send(to, message)).catch(() => {}); } catch (e) {} }

// message templates
const T = {
  applied: (name, role, company) => `Hi ${name || 'there'} 👋 Thanks for applying for *${role}* at ${company}. Your CV has been scored and received. We'll be in touch on this number. — CALIBR`,
  interview: (name, role, when, mode, where) => `Hi ${name || 'there'} 🎯 You're invited to interview for *${role}*.\n🗓 ${when}\n💻 ${mode}${where ? '\n🔗 ' + where : ''}\nReply here if you need to reschedule. — CALIBR`,
  stage: (name, role, stage) => `Hi ${name || 'there'} — an update on your application for *${role}*: status is now *${stage}*. — CALIBR`,
};

module.exports = { enabled, provider, send, fire, e164, T };
