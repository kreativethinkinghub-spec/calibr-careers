'use strict';
// LLM provider — reads the key from env. Anthropic (Claude) preferred, OpenAI fallback.
// Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) OR OPENAI_API_KEY in app/.env
async function complete(prompt, system = '') {
  const anth = process.env.ANTHROPIC_API_KEY;
  const oai = process.env.OPENAI_API_KEY;
  if (anth) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anth, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens: 1800, system, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const j = await r.json();
    return j.content.map(c => c.text || '').join('');
  }
  if (oai) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + oai },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', max_tokens: 1800, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const j = await r.json();
    return j.choices[0].message.content;
  }
  return null; // no key configured
}
function hasKey() { return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY); }
function provider() { return process.env.ANTHROPIC_API_KEY ? 'Anthropic (Claude)' : process.env.OPENAI_API_KEY ? 'OpenAI' : 'none'; }
module.exports = { complete, hasKey, provider };
