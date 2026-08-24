'use strict';
// Deterministic assessment banks (NOT LLM-scored — defensible + free).
// correct: index of right option (knowledge tests). points: per-option score 0-4 (trait tests).
const BANK = {
  aptitude: { label: 'Aptitude', blurb: 'Reasoning across numerical, verbal and logical domains.', kind: 'knowledge', q: [
    { t: 'If 3 machines make 3 units in 3 minutes, how long for 100 machines to make 100 units?', o: ['100 min', '3 min', '33 min', '1 min'], correct: 1 },
    { t: 'Which number completes the series: 2, 6, 12, 20, __ ?', o: ['24', '30', '28', '32'], correct: 1 },
    { t: '"All roses are flowers. Some flowers fade quickly." Therefore:', o: ['All roses fade quickly', 'Some roses may fade quickly', 'No roses fade', 'Roses are not flowers'], correct: 1 },
    { t: 'A shirt costs R240 after a 20% discount. Original price?', o: ['R300', 'R288', 'R260', 'R320'], correct: 0 },
    { t: 'Book is to Reading as Fork is to:', o: ['Kitchen', 'Eating', 'Metal', 'Spoon'], correct: 1 },
  ]},
  technical: { label: 'Technical', blurb: 'Role-relevant technical reasoning.', kind: 'knowledge', q: [
    { t: 'In a spreadsheet, which returns the total of A1 to A10?', o: ['=ADD(A1:A10)', '=SUM(A1:A10)', '=TOTAL(A1:A10)', '=A1+A10'], correct: 1 },
    { t: 'Which is a valid email format?', o: ['name@company', 'name.company.com', 'name@company.co.za', '@name.company'], correct: 2 },
    { t: 'What does "CRM" stand for?', o: ['Customer Records Menu', 'Customer Relationship Management', 'Client Resource Model', 'Central Reporting Module'], correct: 1 },
    { t: 'A file ending in .csv typically stores:', o: ['Images', 'Comma-separated data', 'Compressed video', 'A web page'], correct: 1 },
    { t: 'Which keeps data safest?', o: ['Sharing one password', 'Reusing passwords', 'Unique strong passwords', 'Writing them publicly'], correct: 2 },
  ]},
  cognitive: { label: 'Cognitive', blurb: 'Timed problem-solving and processing.', kind: 'knowledge', q: [
    { t: 'Rearrange TABLE + one letter to make a body part:', o: ['STABLE', 'TABLET', 'BLEAT', 'ABLEST'], correct: 0 },
    { t: 'If today is Wednesday, what day is 100 days from now?', o: ['Thursday', 'Friday', 'Saturday', 'Sunday'], correct: 1 },
    { t: 'Odd one out: Dog, Cat, Lion, Car', o: ['Dog', 'Cat', 'Lion', 'Car'], correct: 3 },
    { t: '5, 10, 20, 40, __', o: ['60', '80', '50', '45'], correct: 1 },
    { t: 'A farmer has 17 sheep, all but 9 run away. How many remain?', o: ['8', '9', '17', '0'], correct: 1 },
  ]},
  personality: { label: 'Personality', blurb: 'Work-style traits — no right answers.', kind: 'trait', q: [
    { t: 'I stay calm and organised under pressure.', o: ['Strongly disagree', 'Disagree', 'Agree', 'Strongly agree'], points: [0,1,3,4] },
    { t: 'I enjoy collaborating closely with a team.', o: ['Strongly disagree', 'Disagree', 'Agree', 'Strongly agree'], points: [0,1,3,4] },
    { t: 'I follow through on commitments even when it is hard.', o: ['Strongly disagree', 'Disagree', 'Agree', 'Strongly agree'], points: [0,1,3,4] },
    { t: 'I adapt quickly when priorities change.', o: ['Strongly disagree', 'Disagree', 'Agree', 'Strongly agree'], points: [0,1,3,4] },
    { t: 'I communicate clearly and listen well.', o: ['Strongly disagree', 'Disagree', 'Agree', 'Strongly agree'], points: [0,1,3,4] },
  ]},
  culture: { label: 'Culture-Fit', blurb: 'Work-style values across 7 dimensions — scored against each company at match time.', kind: 'trait', q: [
    { dim: 'pace', label: 'Pace', t: 'The pace I do my best work at:', o: ['Steady & considered', 'Balanced', 'Fast-moving', 'High-intensity, urgent'], points: [2,3,3,2] },
    { dim: 'autonomy', label: 'Autonomy', t: 'How I like to be managed:', o: ['Clear direction & regular check-ins', 'Some guidance', 'Mostly left to run with it', 'Full ownership, no hand-holding'], points: [2,3,3,2] },
    { dim: 'collaboration', label: 'Collaboration', t: 'I deliver my best results when I:', o: ['Work mostly solo', 'Solo with occasional input', 'Balance solo & team', 'Work closely in a team'], points: [2,2,3,3] },
    { dim: 'risk', label: 'Risk appetite', t: 'My approach to new ideas & risk:', o: ['Stick to what is proven', 'Cautious — test first', 'Willing to experiment', 'Bold — move first'], points: [2,3,3,2] },
    { dim: 'directness', label: 'Directness', t: 'The feedback style I want:', o: ['Gentle & private', 'Tactful', 'Direct & candid', 'Very blunt'], points: [2,3,3,2] },
    { dim: 'structure', label: 'Structure', t: 'I work best with:', o: ['Clear rules & process', 'Some structure', 'Flexible & loose', 'Very little structure'], points: [3,3,2,2] },
    { dim: 'growth', label: 'Growth', t: 'Continuous learning to me is:', o: ['Nice to have', 'Somewhat important', 'Important', 'Core to who I am'], points: [1,2,3,4] },
  ]},
  integrity: { label: 'Integrity', blurb: 'Reliability and honesty indicators.', kind: 'trait', q: [
    { t: 'If I made an error that no one noticed, I would...', o: ['Hide it', 'Wait and see', 'Fix it quietly', 'Flag and fix it'], points: [0,1,3,4] },
    { t: 'Taking small office supplies home is...', o: ['Fine', 'Usually fine', 'Not really okay', 'Not okay'], points: [0,1,3,4] },
    { t: 'I arrive on time for commitments...', o: ['Rarely', 'Sometimes', 'Usually', 'Almost always'], points: [0,1,3,4] },
    { t: 'If asked to bend a rule to hit a target, I would...', o: ['Do it', 'Probably do it', 'Push back', 'Refuse and raise it'], points: [0,1,3,4] },
    { t: 'I keep confidential information...', o: ['Loosely', 'Mostly private', 'Private', 'Strictly private'], points: [0,1,3,4] },
  ]},
};

function grade(type, answers) {
  const a = BANK[type]; if (!a) return 0;
  let raw = 0, max = 0;
  a.q.forEach((q, i) => {
    const pick = parseInt(answers['q' + i], 10);
    if (a.kind === 'knowledge') { max += 1; if (pick === q.correct) raw += 1; }
    else { max += 4; raw += Number.isInteger(pick) && q.points[pick] != null ? q.points[pick] : 0; }
  });
  return Math.round((raw / max) * 100);
}
module.exports = { BANK, grade };
