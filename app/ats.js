'use strict';
// CALIBR ATS engine.
// Works with NO API key (deterministic keyword match), and upgrades to LLM quality when a key is set.
const llm = require('./llm');

// ---------- text utilities ----------
const STOP = new Set(('a an the and or but if then else for to of in on at by with from as is are was were be been being this that these those you your we our they their he she it its i me my will shall can may your yours have has had do does did not no so than into over under out up down about above below after before between during through per via etc eg ie able within across also more most much many any all each other such use used using work works working role job candidate candidates company companies team teams year years month months day days experience experienced strong good excellent ability skills skill knowledge understanding responsible responsibilities requirements required require preferred plus new well ensure provide support drive deliver manage help based across amp nbsp must essential proven track minimum valid record records ideal ideally desirable advantageous relevant related including include includes ensuring meet meeting able ability willing must-have non-negotiable applicant applicants successful join looking seeking seeks position vacancy duties key excellent great').split(/\s+/));
const SYN = { // light SA/tech synonym folding so "js" matches "javascript" etc.
  js: 'javascript', ts: 'typescript', node: 'nodejs', 'node.js': 'nodejs', reactjs: 'react',
  postgres: 'postgresql', pg: 'postgresql', sql: 'sql',
  aws: 'aws', gcp: 'googlecloud', 'c#': 'csharp', 'c++': 'cplusplus', ba: 'businessanalyst',
  pm: 'projectmanagement', hr: 'humanresources', kam: 'keyaccountmanagement',
};
// crude singulariser so "accounts" and "account" match consistently on both sides
function stem(w) { if (w.length > 4) { if (w.endsWith('ies')) return w.slice(0, -3) + 'y'; if (w.endsWith('sses')) return w.slice(0, -2); if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1); } return w; }
function norm(w) { w = w.toLowerCase().replace(/[^a-z0-9+#]/g, ''); w = SYN[w] || w; return stem(w); }
function tokens(text) { return (text || '').toLowerCase().match(/[a-z][a-z0-9+#]{1,}/g) || []; }
function contentWords(text) {
  const out = [];
  for (const t of tokens(text)) { if (STOP.has(t)) continue; const n = norm(t); if (n.length > 2 && !STOP.has(n)) out.push(n); }
  return out;
}
// Domain skills/qualifications common in SA job ads — these are always signal and rank higher.
const SKILL = new Set('excel word powerpoint outlook sql python java javascript typescript react nodejs php sap salesforce crm erp pastel sage quickbooks xero autocad revit solidworks matric diploma degree bcom btech nqf saica saipa cima acca ifrs gaap payroll reconciliation reconciliations bookkeeping tax audit auditing vat forecasting budgeting reporting analytics fmcg retail wholesale logistics warehouse procurement supply inventory merchandising sales marketing seo ppc negotiation prospecting pipeline account accounts recruitment sourcing onboarding compliance popia bbee governance nursing pharmacy phlebotomy hse safety welding fitting electrical plumbing driver drivers licence code10 code14 forklift plc scada azure aws gcp linux docker kubernetes git agile scrum communication leadership management supervision planning coordination'.split(/\s+/).map(stem));
const mustCue = /(must|required|essential|minimum|min\.|proven|at least|\d+\+?\s*years?|degree|diploma|certif|nqf|matric|drivers?\s*licen[cs]e|b-?bbee|non-?negotiable)/i;

function lineFor(text, term) {
  const lines = (text || '').split(/[\n.;:!?•|]/);
  const l = lines.find(x => new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(x));
  return l || '';
}

// ---------- deterministic JD keyword extraction (unigram + skill-lexicon; no junk bigrams) ----------
function extractKeywords(jdText, max = 22) {
  const words = contentWords(jdText);
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const scored = Object.entries(freq).map(([term, f]) => {
    let weight = f;
    if (SKILL.has(term)) weight += 4;          // known skill/qualification
    if (term.length >= 7) weight += 1;         // specific terms
    if (/^\d/.test(term)) weight -= 2;         // bare numbers are weak
    return { term, weight, must: mustCue.test(lineFor(jdText, term)) };
  }).filter(s => s.weight > 0);
  // must-haves and skills float up
  scored.sort((a, b) => (b.weight + (b.must ? 3 : 0)) - (a.weight + (a.must ? 3 : 0)));
  const seen = new Set(), ranked = [];
  for (const s of scored) { if (seen.has(s.term)) continue; seen.add(s.term); ranked.push(s); if (ranked.length >= max) break; }
  return ranked;
}

// ---------- deterministic CV↔JD match ----------
function matchCV(cvText, keywords) {
  const cvBag = new Set(contentWords(cvText));
  const matched = [], missing = [];
  let got = 0, tot = 0;
  for (const k of keywords) {
    const term = norm(k.term.replace(/\s*\*$/, ''));
    const w = Math.max(1, k.weight) * (k.must ? 2 : 1);
    tot += w;
    const present = cvBag.has(term) || k.term.split(/\s+/).every(part => cvBag.has(norm(part)));
    if (present) { got += w; matched.push(k.term.replace(/\s*\*$/, '')); }
    else missing.push(k.term.replace(/\s*\*$/, '') + (k.must ? ' *' : '')); // * = must-have gap
  }
  const match = tot ? Math.round(100 * got / tot) : 0;
  const flags = parseFlags(cvText);
  return { match, matched, missing, flags, engine: 'keyword' };
}
function parseFlags(cv) {
  const f = [];
  if (/\t| {4,}/.test(cv) && /\|/.test(cv)) f.push('Looks like a table/columns — many ATS parsers scramble multi-column layouts. Use a single column.');
  if (!/(@|e-?mail)/i.test(cv)) f.push('No email detected — ensure contact details are plain text, not in a header/image.');
  if (!/\b(19|20)\d{2}\b/.test(cv)) f.push('No dates detected — add clear month/year ranges for each role.');
  if ((cv.match(/[•▪●]/g) || []).length === 0) f.push('No bullet points — ATS and recruiters scan bullets faster than paragraphs.');
  if (cv.length < 400) f.push('CV looks very short — add measurable achievements per role.');
  return f;
}

// ---------- robust JSON-from-LLM ----------
async function llmJSON(prompt, system) {
  if (!llm.hasKey()) return null;
  let raw;
  try { raw = await llm.complete(prompt, system); } catch (e) { return { _error: e.message }; }
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { _error: 'no JSON in response' };
  try { return JSON.parse(m[0]); } catch (e) { return { _error: 'bad JSON: ' + e.message }; }
}

// ---------- public API ----------
// Parse a job ad into structured keywords/requirements (LLM if available, else deterministic).
async function parseJD(jdText) {
  const kwDet = extractKeywords(jdText);
  const j = await llmJSON(
    `Extract the hiring signals from this South African job advert. Return ONLY JSON:
{"title":"","seniority":"junior|mid|senior|exec","must_have":["skill/qualification", "..."],"nice_to_have":["..."],"keywords":["ranked ATS keywords, most important first"],"summary":"one line"}
Job advert:
${jdText.slice(0, 6000)}`,
    'You are an ATS and recruitment expert. Output strict JSON only, no prose.');
  if (j && !j._error && Array.isArray(j.keywords) && j.keywords.length) {
    const must = new Set((j.must_have || []).map(x => String(x).toLowerCase()));
    const keywords = j.keywords.slice(0, 24).map(term => ({ term: String(term).toLowerCase(), weight: 3, must: must.has(String(term).toLowerCase()) }));
    // fold in any must_have not already present
    (j.must_have || []).forEach(t => { const term = String(t).toLowerCase(); if (!keywords.find(k => k.term === term)) keywords.push({ term, weight: 4, must: true }); });
    return { title: j.title || '', seniority: j.seniority || '', summary: j.summary || '', must_have: j.must_have || [], nice_to_have: j.nice_to_have || [], keywords, source: 'llm' };
  }
  return { title: '', seniority: '', summary: '', must_have: kwDet.filter(k => k.must).map(k => k.term), nice_to_have: [], keywords: kwDet, source: 'keyword' };
}

// Score a CV against a parsed JD (keywords array). LLM adds a nuanced read on top of the deterministic match.
async function scoreCV(cvText, keywords, jdText) {
  const det = matchCV(cvText, keywords);
  const j = await llmJSON(
    `Assess how well this CV fits the job. Return ONLY JSON:
{"match":0-100,"missing":["important requirements the CV lacks"],"strengths":["genuine matches"],"seniority_fit":"under|on|over","summary":"2 sentences, honest"}
JOB:
${(jdText || '').slice(0, 3500)}
CV:
${(cvText || '').slice(0, 4500)}`,
    'You are a fair, evidence-based South African recruiter. Never invent experience the CV does not show. Strict JSON only.');
  if (j && !j._error && typeof j.match === 'number') {
    // blend deterministic keyword match with LLM judgement (keeps it grounded)
    const blended = Math.round(0.5 * det.match + 0.5 * Math.max(0, Math.min(100, j.match)));
    return { match: blended, matched: (j.strengths || det.matched), missing: (j.missing || det.missing), flags: det.flags, seniority_fit: j.seniority_fit || '', summary: j.summary || '', engine: 'llm+keyword', det: det.match };
  }
  return { ...det, seniority_fit: '', summary: '' };
}

// Optimise a CV against a specific job ad + chosen ATS engine.
async function optimizeCV(cvText, jdText, atsEngine) {
  const parsed = await parseJD(jdText);
  const before = matchCV(cvText, parsed.keywords);
  const engineNote = ATS_ENGINES[atsEngine] ? `Target ATS: ${atsEngine}. ${ATS_ENGINES[atsEngine].note}` : '';
  const j = await llmJSON(
    `Rewrite this CV to rank higher for the specific job below, in the South African market. ${engineNote}
Rules: keep it 100% truthful (never invent employers, dates, or qualifications); weave in the job's real keywords ONLY where the candidate genuinely has that experience; single-column, ATS-safe plain text; strong action verbs; quantify results. Return ONLY JSON:
{"rewritten_cv":"full plain-text CV","added_keywords":["keywords you legitimately surfaced"],"still_missing":["gaps the candidate must close honestly"],"tips":["3-6 ATS tips specific to this job/engine"]}
JOB:
${jdText.slice(0, 4000)}
CV:
${cvText.slice(0, 5000)}`,
    'You are an elite South African CV writer and ATS specialist. Truthful, concise. Strict JSON only.');
  let after = before, rewritten = null, tips = [], added = [], missing = before.missing;
  if (j && !j._error && j.rewritten_cv) {
    rewritten = j.rewritten_cv; tips = j.tips || []; added = j.added_keywords || []; missing = j.still_missing || before.missing;
    after = matchCV(rewritten, parsed.keywords);
  }
  return {
    hasLLM: llm.hasKey(),
    engine: atsEngine || 'Generic',
    before: before.match, after: after.match,
    matched: before.matched, missing,
    added, tips, flags: (rewritten ? after.flags : before.flags),
    rewritten, keywords: parsed.keywords, parsed,
    error: (j && j._error) || null,
  };
}

// Real ATS engines candidates actually get parsed by (drives parse-safety guidance).
const ATS_ENGINES = {
  'Workday': { note: 'Workday parses single-column PDFs well but drops text in headers/footers and text boxes.' },
  'Greenhouse': { note: 'Greenhouse prefers clean .docx/PDF, standard section headings (Experience, Education, Skills).' },
  'SAP SuccessFactors': { note: 'SuccessFactors (big SA corporates/gov) is strict — avoid tables, columns and graphics; use plain headings.' },
  'Oracle Taleo': { note: 'Taleo is keyword-literal and old — exact-match keywords from the ad, no fancy formatting.' },
  'Simplify / LinkedIn': { note: 'Prefer standard fields; keep skills as a plain comma list.' },
  'Generic': { note: 'Single column, standard headings, plain bullets, keywords in context.' },
};

module.exports = { parseJD, scoreCV, optimizeCV, extractKeywords, matchCV, ATS_ENGINES };
