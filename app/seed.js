'use strict';
// Idempotent demo seed so the job board + careers pages look alive.
// Run:  node seed.js   (honours DB_PATH). Safe to re-run — it no-ops if already seeded.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { BANK, grade } = require('./assessments');
const now = () => new Date().toISOString();
const AXES = ['Skills / Technical', 'Aptitude / Cognitive', 'Personality', 'Culture-Fit', 'Integrity'];

function seed() {
  if (db.get("SELECT id FROM companies WHERE name=?", 'Kasi Fresh Foods (Demo)')) { console.log('Already seeded — nothing to do.'); return; }
  const hash = bcrypt.hashSync(crypto.randomBytes(9).toString('hex'), 10);

  // demo employer + company (culture profile set)
  const cprofile = JSON.stringify(BANK.culture.q.map(() => 2));
  const cweights = JSON.stringify(BANK.culture.q.map(() => 2));
  const co = db.run('INSERT INTO companies (name, culture, culture_w, created_at) VALUES (?,?,?,?)', 'Kasi Fresh Foods (Demo)', cprofile, cweights, now());
  const cid = Number(co.lastInsertRowid);
  const emp = db.run('INSERT INTO users (role,name,email,pass,company_id,consent_at,created_at) VALUES (?,?,?,?,?,?,?)', 'employer', 'Demo Employer', 'demo-employer@calibr-careers.tech', hash, cid, now(), now());
  db.run('UPDATE companies SET owner_id=? WHERE id=?', Number(emp.lastInsertRowid), cid);

  // two public demo roles
  const roles = [
    { title: 'Retail Store Manager', description: 'Store manager for a busy Kasi Fresh outlet. Skills: team leadership, stock control, POS, customer service, reporting, POPIA. Matric required, 3+ years retail.', location: 'Soweto, Gauteng', salary_min: 240000, salary_max: 360000 },
    { title: 'Junior Data Analyst', description: 'Analyse sales and supply data. Skills: Excel, SQL, reporting, communication, attention to detail. NQF 6 or degree preferred.', location: 'Cape Town', salary_min: 300000, salary_max: 480000 },
  ];
  const weights = JSON.stringify(Object.fromEntries(AXES.map(k => [k, 20])));
  const roleIds = roles.map(r => {
    const token = crypto.randomBytes(5).toString('hex');
    const ins = db.run(`INSERT INTO roles_posted (company_id,title,description,location,emp_type,salary_min,salary_max,salary,weights,is_public,public_token,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, cid, r.title, r.description, r.location, 'Full-time', r.salary_min, r.salary_max, r.salary_max, weights, 1, token, 'open', now());
    return Number(ins.lastInsertRowid);
  });

  // a demo candidate with a full CALIBR Score, added to the first role's pipeline
  const seeker = db.run('INSERT INTO users (role,name,email,pass,phone,consent_at,cv,created_at) VALUES (?,?,?,?,?,?,?,?)',
    'seeker', 'Demo Candidate', 'demo-candidate@calibr-careers.tech', hash, '+27821234567', now(),
    'Retail supervisor with 4 years experience. Skills: team leadership, stock control, POS, customer service, reporting, Excel, POPIA. Matric.', now());
  const uid = Number(seeker.lastInsertRowid);
  const m = {};
  for (const t of ['aptitude', 'technical', 'cognitive', 'personality', 'culture', 'integrity']) {
    const ans = {}; BANK[t].q.forEach((q, i) => ans['q' + i] = BANK[t].kind === 'knowledge' ? q.correct : 3);
    m[t] = grade(t, ans);
    const raw = JSON.stringify(Object.fromEntries(BANK[t].q.map((q, i) => ['q' + i, BANK[t].kind === 'knowledge' ? q.correct : 3])));
    db.run('INSERT INTO assessments (user_id,type,status,score,raw,taken_at) VALUES (?,?,?,?,?,?)', uid, t, 'done', m[t], raw, now());
  }
  const axes = { 'Skills / Technical': m.technical, 'Aptitude / Cognitive': Math.round((m.aptitude + m.cognitive) / 2), 'Personality': m.personality, 'Culture-Fit': m.culture, 'Integrity': m.integrity };
  const composite = Math.round(Object.values(axes).reduce((a, b) => a + b, 0) / AXES.length);
  db.run('INSERT INTO scores (user_id,composite,axes,token,issued_at) VALUES (?,?,?,?,?)', uid, composite, JSON.stringify(axes), crypto.randomBytes(6).toString('hex'), now());
  db.run('INSERT INTO applications (role_id,user_id,stage,fit,source,created_at) VALUES (?,?,?,?,?,?)', roleIds[0], uid, 'Shortlist', composite, 'pool', now());

  console.log(`Seeded: company ${cid}, ${roleIds.length} public roles, 1 scored candidate (composite ${composite}).`);
  console.log(`Careers page: /careers/${cid}`);
}
seed();
