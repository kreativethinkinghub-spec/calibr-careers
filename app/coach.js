'use strict';
// Job-seeker AI tools: mock interview, cover letters, growth path.
// Each works with NO API key (sensible deterministic output) and upgrades when a key is set.
const llm = require('./llm');
const ats = require('./ats');

async function llmText(prompt, system) {
  if (!llm.hasKey()) return null;
  try { return await llm.complete(prompt, system); } catch (e) { return '__ERR__' + e.message; }
}
async function llmJSON(prompt, system) {
  const raw = await llmText(prompt, system);
  if (!raw) return null;
  if (raw.startsWith('__ERR__')) return { _error: raw.slice(7) };
  const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return { _error: 'no JSON' };
  try { return JSON.parse(m[0]); } catch (e) { return { _error: 'bad JSON' }; }
}

// ---------- Mock interview ----------
// Generate role-specific questions (LLM), else a solid generic SA behavioural set.
async function interviewQuestions(role, jd) {
  const j = await llmJSON(
    `Generate 6 realistic interview questions for a "${role}" role in South Africa${jd ? ', based on this job ad:\n' + jd.slice(0, 2500) : ''}.
Mix behavioural, role-specific and one situational. Return ONLY a JSON array of 6 strings.`,
    'You are an experienced South African hiring manager. Strict JSON array only.');
  if (Array.isArray(j) && j.length) return j.slice(0, 6).map(String);
  return [
    `Tell me about yourself and why you're a fit for a ${role} role.`,
    `Describe a time you solved a difficult problem at work. What did you do?`,
    `Tell me about a time you worked in a team under pressure or a tight deadline.`,
    `What are your biggest strengths, and one weakness you're actively improving?`,
    `Describe a mistake you made and what you learned from it.`,
    `Why do you want this role, and where do you see yourself in three years?`,
  ];
}
// Score + feedback on the answers (LLM), else a deterministic content check.
async function interviewFeedback(role, qa) {
  const j = await llmJSON(
    `Assess this candidate's mock interview for a "${role}" role in South Africa. For each answer give brief, honest, constructive feedback and a 0-100 score. Return ONLY JSON:
{"overall":0-100,"summary":"2 sentences","items":[{"feedback":"","score":0-100}]}
Q&A:\n${qa.map((x, i) => `${i + 1}. Q: ${x.q}\n   A: ${x.a || '(no answer)'}`).join('\n')}`,
    'You are a supportive but rigorous SA interview coach. Strict JSON only.');
  if (j && !j._error && Array.isArray(j.items)) {
    return { overall: clamp(j.overall), summary: j.summary || '', items: qa.map((x, i) => ({ ...x, feedback: (j.items[i] && j.items[i].feedback) || '', score: clamp(j.items[i] && j.items[i].score) })), engine: 'llm' };
  }
  // deterministic fallback: reward specificity, length, action words, numbers
  const items = qa.map(x => {
    const a = (x.a || '').trim(); const words = a.split(/\s+/).filter(Boolean).length;
    const hasNum = /\d/.test(a); const hasAction = /(led|built|managed|improved|delivered|solved|increased|reduced|created|achieved|handled|resolved)/i.test(a);
    let s = 30; if (words > 30) s += 20; if (words > 70) s += 15; if (hasNum) s += 15; if (hasAction) s += 15;
    s = clamp(Math.min(95, s));
    const tips = [];
    if (words < 40) tips.push('add more detail — aim for a full STAR answer (Situation, Task, Action, Result)');
    if (!hasNum) tips.push('quantify the result (%, R, time saved)');
    if (!hasAction) tips.push('lead with strong action verbs showing what YOU did');
    return { ...x, score: s, feedback: tips.length ? 'Good start. To strengthen: ' + tips.join('; ') + '.' : 'Strong, specific answer with a clear result.' };
  });
  const overall = Math.round(items.reduce((t, i) => t + i.score, 0) / (items.length || 1));
  return { overall, summary: 'Practice scored on specificity, structure and measurable results. Add numbers and STAR structure to lift weaker answers.', items, engine: 'keyword' };
}

// ---------- Cover letter ----------
async function coverLetter(name, role, company, cv, jd) {
  const out = await llmText(
    `Write a concise, professional South African cover letter for ${name || 'the candidate'} applying for "${role}"${company ? ' at ' + company : ''}. Ground it in the CV; align to the job ad; truthful, no clichés, ~250-320 words, ready to send. Return just the letter.
${jd ? 'JOB AD:\n' + jd.slice(0, 2500) + '\n' : ''}CV:\n${(cv || '').slice(0, 3500)}`,
    'You are an expert SA cover-letter writer. Warm, specific, professional.');
  if (out && !out.startsWith('__ERR__')) return { body: out, engine: 'llm' };
  if (out && out.startsWith('__ERR__')) return { body: null, error: out.slice(7) };
  // no-key template
  const kws = jd ? (await ats.parseJD(jd)).keywords.slice(0, 6).map(k => k.term).join(', ') : '';
  const body = `Dear Hiring Manager,\n\nI am writing to apply for the ${role} position${company ? ' at ' + company : ''}. Having reviewed the role, I believe my experience makes me a strong fit and I would welcome the opportunity to contribute.\n\nAcross my career I have built directly relevant experience${kws ? ', including ' + kws : ''}. I focus on delivering measurable results, working well within a team, and taking ownership of outcomes. I am confident I can bring the same commitment to your team.\n\nI would welcome the chance to discuss how I can add value${company ? ' to ' + company : ''}. Thank you for considering my application — I look forward to hearing from you.\n\nYours sincerely,\n${name || ''}`;
  return { body, engine: 'template' };
}

// ---------- Growth Path ----------
// From the CALIBR Score axes (+ optional target role), produce a prioritised roadmap.
async function growthPath(axes, targetRole) {
  const sorted = Object.entries(axes || {}).sort((a, b) => a[1] - b[1]);
  const weakest = sorted.slice(0, 2).map(([k, v]) => ({ axis: k, score: v }));
  const j = await llmJSON(
    `A South African job seeker has this CALIBR Score profile: ${JSON.stringify(axes)}${targetRole ? `, targeting "${targetRole}"` : ''}.
Give a practical growth roadmap. Return ONLY JSON:
{"focus":["the 2 axes to prioritise and why"],"steps":[{"title":"","detail":"","axis":""}],"quickWins":["3 things to do this month"]}
Keep steps concrete and SA-relevant (free/low-cost resources where possible). 4-6 steps.`,
    'You are a pragmatic SA career coach. Strict JSON only.');
  if (j && !j._error && Array.isArray(j.steps)) return { ...j, weakest, engine: 'llm' };
  // deterministic fallback keyed to weakest axes
  const lib = {
    'Skills / Technical': { detail: 'Close a concrete skill gap: pick one tool/skill from your target roles and complete a free course (Coursera/YouTube), then build one portfolio piece.', win: 'List your top 5 hard skills and rate yourself 1–5 honestly.' },
    'Aptitude / Cognitive': { detail: 'Practise numerical & logical reasoning 20 min/day (free aptitude test banks) — most SA graduate programmes screen on this.', win: 'Do one timed practice aptitude test this week.' },
    'Personality': { detail: 'Gather structured feedback: ask 3 colleagues for one strength and one blind spot, and act on the theme.', win: 'Request feedback from 3 people this week.' },
    'Culture-Fit': { detail: 'Research target companies’ values and prepare 2 stories that show you living those values.', win: 'Write 2 STAR stories mapped to company values.' },
    'Integrity': { detail: 'Prepare honest examples of accountability and ethical choices — integrity questions reward candour, not perfection.', win: 'Draft one “time I owned a mistake” story.' },
  };
  const steps = weakest.map(w => ({ title: `Lift your ${w.axis} (currently ${w.score})`, detail: (lib[w.axis] || {}).detail || 'Focus practice and gather feedback in this area.', axis: w.axis }));
  steps.push({ title: 'Re-take your assessments', detail: 'After 4–6 weeks of focused practice, re-generate your CALIBR Score to prove the growth to employers.', axis: '' });
  return { focus: weakest.map(w => `${w.axis} is your lowest axis (${w.score}) — biggest, fastest gain.`), steps, quickWins: weakest.map(w => (lib[w.axis] || {}).win).filter(Boolean).concat(['Apply to 3 roles with your CALIBR Score attached.']), weakest, engine: 'keyword' };
}

function clamp(n) { n = Number(n); if (Number.isNaN(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); }

module.exports = { interviewQuestions, interviewFeedback, coverLetter, growthPath };
