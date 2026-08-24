'use strict';
// Paystack integration (ZAR). Activates when PAYSTACK_SECRET_KEY is set in app/.env.
// Never hard-code keys. Test keys start sk_test_ / pk_test_, live keys sk_live_ / pk_live_.
const crypto = require('crypto');

function hasKeys() { return !!process.env.PAYSTACK_SECRET_KEY; }
function publicKey() { return process.env.PAYSTACK_PUBLIC_KEY || ''; }

// Seeker subscription plans (monthly, ZAR). Matches the site pricing.
const PLANS = {
  starter: { name: 'Starter', amount: 199, blurb: 'Score + ATS + job apply' },
  pro: { name: 'Pro', amount: 349, blurb: 'Everything + Mock Interview + Growth Path' },
  premium: { name: 'Premium', amount: 499, blurb: 'Pro + priority support' },
};

// Employer subscription plans (monthly, ZAR). Flat subscription — NO success fee.
// Matches the site: Startup R1,499 / Growth R4,999 / Enterprise custom.
const EMPLOYER_PLANS = {
  startup: { name: 'Startup', amount: 1499, blurb: 'Up to 5 roles · unlimited screening · Score · ATS · distribution · EE reports' },
  growth: { name: 'Growth', amount: 4999, blurb: 'Up to 20 roles · + Culture-Fit · bulk ranking · connect your boards · analytics' },
  enterprise: { name: 'Enterprise', amount: 0, custom: true, blurb: 'Unlimited roles & seats · SSO · white-label · API · dedicated manager · SLA' },
};

// Initialize a transaction; returns { authorization_url, reference } to redirect the user to.
async function initTransaction({ email, amount, reference, callback_url, metadata }) {
  if (!hasKeys()) throw new Error('Paystack not configured');
  const r = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, amount: Math.round(amount * 100), currency: 'ZAR', reference, callback_url, metadata }),
  });
  const j = await r.json();
  if (!r.ok || !j.status) throw new Error('Paystack init: ' + (j.message || r.status));
  return j.data; // { authorization_url, access_code, reference }
}

// Verify a transaction by reference (used on callback and as webhook backup).
async function verify(reference) {
  if (!hasKeys()) throw new Error('Paystack not configured');
  const r = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
    headers: { authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY },
  });
  const j = await r.json();
  if (!r.ok || !j.status) throw new Error('Paystack verify: ' + (j.message || r.status));
  return j.data; // { status: 'success', amount, ... }
}

// Validate a webhook signature (Paystack signs the raw body with HMAC-SHA512 of the secret key).
function validSignature(rawBody, signature) {
  if (!hasKeys() || !signature) return false;
  const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  return hash === signature;
}

function ref(prefix) { return prefix + '_' + crypto.randomBytes(8).toString('hex'); }

module.exports = { hasKeys, publicKey, PLANS, EMPLOYER_PLANS, initTransaction, verify, validSignature, ref };
