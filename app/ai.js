'use strict';
// AI copilots for hiring. Each function uses the LLM when a key is set (llm.js) and
// otherwise falls back to a deterministic, genuinely useful template — so every feature
// works with no key and simply gets sharper once ANTHROPIC_API_KEY / OPENAI_API_KEY is set.
const llm = require('./llm');

const SA_SYSTEM = 'You are CALIBR, a South African hiring assistant. Write in clear South African English. Be POPIA-aware and B-BBEE / Employment Equity conscious. Never invent facts about a candidate. Be concise and practical.';

async function tryLLM(prompt, system) {
  if (!llm.hasKey()) return null;
  try { const t = await llm.complete(prompt, system || SA_SYSTEM); return t && t.trim() ? t.trim() : null; } catch (e) { return null; }
}

// ---------- 1. JD writer ----------
async function writeJD({ title, seniority, skills, location, company, emp_type }) {
  const t = (title || 'the role').trim();
  const ai = await tryLLM(
    `Write a compelling, inclusive job description for this role at a South African employer.\nRole: ${t}\nSeniority: ${seniority || 'not specified'}\nMust-have skills: ${skills || 'not specified'}\nLocation: ${location || 'South Africa'}\nEmployment type: ${emp_type || 'Full-time'}\nCompany: ${company || 'the company'}\n\nStructure: a 2-sentence intro, "What you'll do" (5-6 bullets), "What you'll bring" (5-6 bullets), "Nice to have" (3 bullets), and a short "How we hire" line noting the process is evidence-based and POPIA-compliant. Keep it under 350 words. Plain text with simple bullet dashes.`,
    SA_SYSTEM);
  if (ai) return { text: ai, ai: true };
  // deterministic fallback
  const sk = (skills || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  const mk = arr => arr.length ? arr.map(s => '- ' + s).join('\n') : '- (add specifics)';
  const text =
`${t}${location ? ' · ' + location : ''}${emp_type ? ' · ' + emp_type : ''}

${company || 'We'} are hiring ${/^[aeiou]/i.test(t) ? 'an' : 'a'} ${t}${seniority ? ' (' + seniority + ')' : ''}. This is a role where evidence and impact matter more than a polished CV — we hire on demonstrated ability.

What you'll do
- Own the core outcomes this role is measured on
- Work closely with the team to deliver, review and improve
- Bring rigour, ownership and clear communication to your work
- Contribute to a fair, transparent hiring and delivery culture

What you'll bring
${mk(sk.slice(0, 6))}
- Strong communication and problem-solving
- A track record you can point to

Nice to have
${mk(sk.slice(6, 9).length ? sk.slice(6, 9) : ['Relevant SA industry exposure', 'A qualification aligned to the role', 'A growth mindset'])}

How we hire
You'll be assessed on evidence — a CALIBR Score and role-fit — not just an interview. Your data is handled POPIA-first, and we welcome applicants from all backgrounds in line with Employment Equity.`;
  return { text, ai: false };
}

// ---------- 2. CV summary (never invents) ----------
async function summariseCV(cvText, roleTitle) {
  const cv = (cvText || '').slice(0, 6000);
  if (!cv.trim()) return { text: 'No CV text on file.', ai: false, strengths: [], risks: [] };
  const ai = await tryLLM(
    `Summarise this candidate's CV for a hiring manager screening for "${roleTitle || 'the role'}". Use ONLY what's in the CV — do not invent employers, dates or skills. Output: a 2-sentence summary, then "Strengths:" (3 bullets) and "Watch-outs:" (2 bullets, e.g. gaps or missing evidence). Plain text.\n\nCV:\n${cv}`,
    SA_SYSTEM);
  if (ai) return { text: ai, ai: true };
  // fallback: pull signal words + first meaningful lines
  const lines = cv.split(/\n+/).map(l => l.trim()).filter(l => l.length > 3);
  const lead = lines.slice(0, 2).join(' ').slice(0, 240);
  const LEX = ['management','leadership','sales','crm','excel','sql','python','marketing','finance','accounting','hr','recruitment','project','communication','negotiation','reporting','analytics','customer','operations','logistics','engineering','design','popia','b-bbee','matric','degree','diploma','nqf'];
  const low = cv.toLowerCase();
  const found = LEX.filter(k => low.includes(k));
  const yrs = (cv.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
  const span = yrs.length ? Math.max(...yrs) - Math.min(...yrs) : null;
  const strengths = [
    found.slice(0, 4).length ? 'Signals: ' + found.slice(0, 6).join(', ') : 'Relevant experience described',
    span ? `~${span} years of history referenced` : 'Recent experience listed',
    'Applied directly against this role',
  ];
  const risks = [
    found.length < 3 ? 'Few role-relevant keywords detected — verify depth in interview' : 'Confirm depth vs breadth of the listed skills',
    'CALIBR Score not yet taken — evidence is self-reported until assessed',
  ];
  return { text: `${lead}\n\nStrengths:\n- ${strengths.join('\n- ')}\n\nWatch-outs:\n- ${risks.join('\n- ')}`, ai: false, strengths, risks };
}

// ---------- 3. Interview questions from the role's scorecard ----------
async function interviewQuestions({ title, criteria }) {
  const crit = (criteria && criteria.length ? criteria : [{ name: 'Skills' }, { name: 'Experience' }, { name: 'Problem-solving' }, { name: 'Communication' }, { name: 'Culture fit' }]);
  const ai = await tryLLM(
    `Generate a structured interview kit for "${title || 'the role'}". For each criterion below, give 2 behavioural/situational questions and a one-line "look-for". Criteria: ${crit.map(c => c.name).join(', ')}. Keep it tight, plain text, grouped by criterion.`,
    SA_SYSTEM);
  if (ai) return { text: ai, ai: true };
  const bank = {
    skill: ['Walk me through a recent piece of work that best shows this skill — what was your specific contribution?', 'Where have you had to learn this quickly on the job? How did you close the gap?'],
    experience: ['Tell me about the most relevant thing you\'ve done for a role like this.', 'Describe a result you\'re proud of — how did you measure it?'],
    problem: ['Tell me about a hard problem you solved with limited information.', 'Describe a time your first approach failed — what did you change?'],
    communication: ['Describe explaining something complex to someone without your background.', 'Tell me about a disagreement you handled well.'],
    culture: ['Describe the environment you do your best work in.', 'Tell me about a time your values were tested at work.'],
    default: ['Tell me about a time this mattered in your work.', 'What would great look like here in your first 90 days?'],
  };
  const key = n => { n = n.toLowerCase(); if (/skill|technical/.test(n)) return 'skill'; if (/experience/.test(n)) return 'experience'; if (/problem|solv/.test(n)) return 'problem'; if (/communic/.test(n)) return 'communication'; if (/culture|value|fit/.test(n)) return 'culture'; return 'default'; };
  const text = crit.map(c => { const qs = bank[key(c.name)]; return `${c.name}\n- ${qs[0]}\n- ${qs[1]}\n  Look for: specific, first-person evidence with a measurable outcome.`; }).join('\n\n');
  return { text, ai: false };
}

// ---------- 4. Structured feedback from raw notes ----------
async function structureFeedback(notes, rec) {
  const n = (notes || '').slice(0, 3000);
  if (!n.trim()) return { text: 'Add your interview notes to generate structured feedback.', ai: false };
  const ai = await tryLLM(
    `Turn these raw interview notes into fair, structured, evidence-based feedback. Do not invent anything. Output "Summary", "Strengths", "Concerns", and "Recommendation: ${rec || 'your call'}". Keep it professional and specific. Notes:\n${n}`,
    SA_SYSTEM);
  if (ai) return { text: ai, ai: true };
  return { text: `Summary\n${n.slice(0, 300)}\n\nStrengths\n- ${n.split(/[.\n]/).filter(s => /good|strong|clear|solid|impress/i.test(s)).slice(0, 3).map(s => s.trim()).join('\n- ') || 'See notes'}\n\nConcerns\n- ${n.split(/[.\n]/).filter(s => /concern|weak|gap|unsure|lack|risk/i.test(s)).slice(0, 3).map(s => s.trim()).join('\n- ') || 'None flagged in notes'}\n\nRecommendation: ${rec || 'your call'}`, ai: false };
}

module.exports = { writeJD, summariseCV, interviewQuestions, structureFeedback, hasKey: llm.hasKey, provider: llm.provider };
