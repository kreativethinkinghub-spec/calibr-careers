(function () {
  // ═══════════════════════════════════════════════════════
  //  CALI — CALIBR assistant. Clean SaaS. Coral + pink only.
  //  No emoji, no icons. Typography-first.
  // ═══════════════════════════════════════════════════════

  var GREETINGS = [
    "Hi. I'm Cali. Ask me about pricing, security, POPIA, courses, or how to get started.",
    "Cali here. What are you trying to figure out?",
    "Welcome. I'm Cali, the CALIBR assistant. How can I help?"
  ];

  var KB = [
    { keywords: ['price', 'pricing', 'cost', 'how much', 'fee', 'plan'],
      a: "<strong>Individual plans:</strong> Starter R149/mo, Pro R299/mo, Pro+ R549/mo.<br><br><strong>Company plans:</strong> Startup R2,999/mo, Growth R8,999/mo, Enterprise custom.<br><br><strong>Academy courses:</strong> from R1,999 per learner (Microsoft/AWS certification-track). Bundle packs save 30–50%.<br><br><a href='pricing.html'>See full pricing</a>" },

    { keywords: ['trial', 'free', 'demo', 'try', 'test', 'explore'],
      a: "Two ways in:<br><br><strong>1. Explore the demo</strong> — no signup, no card. <a href='demo-individual.html'>Job seeker demo</a> or <a href='demo-company.html'>company demo</a>.<br><br><strong>2. Start a 14-day trial</strong> — full platform, cancel anytime from settings.<br><br>Or <a href='contact.html'>book a demo call</a> for a real walkthrough." },

    { keywords: ['cv', 'resume', 'ats'],
      a: "The CV Optimizer scores your CV against real Applicant Tracking Systems, flags what breaks, and rewrites it in your voice. Twenty templates across corporate, tech, creative, graduate, and executive categories. <a href='cv-optimizer.html'>See how it works</a>." },

    { keywords: ['interview', 'mock', 'practice'],
      a: "Practice with AI interviewers across behavioural, technical, case study, and panel formats. Real-time feedback on structure, filler words, confidence. <a href='interview-prep.html'>See how it works</a>." },

    { keywords: ['calibr score', 'score', 'credential', 'verified'],
      a: "Your CALIBR Score combines your CV, assessments, interviews, and skills into one tamper-proof verified credential. Share it with a single link. <a href='calibr-score.html'>See how it works</a>." },

    { keywords: ['secur', 'popia', 'privacy', 'data', 'gdpr', 'complian'],
      a: "POPIA compliant end-to-end:<br><br><strong>SA data residency</strong> — hosted in South Africa.<br><strong>Encryption</strong> — AES-256 at rest, TLS 1.3 in transit.<br><strong>Deletion</strong> — request removal, done within 30 days.<br><strong>Information Officer</strong> — Karli Thebe (Founder, KTH Tech).<br><br><a href='privacy.html'>Full privacy policy</a> · <a href='cybersecurity.html'>Cybersecurity services</a>" },

    { keywords: ['bbee', 'b-bbee', 'transformation', 'ee', 'equity'],
      a: "B-BBEE and Employment Equity reporting is included in every Company plan. Pillar 3 (Skills Development) and EE dashboards, aligned to the Amended Codes. Once our MICT SETA accreditation lands (Q3 2027), our AI training also qualifies for SDL claim-back plus B-BBEE Skills Development points." },

    { keywords: ['hire', 'hiring', 'employer', 'company plan', 'recruit'],
      a: "For companies: pre-screened candidates with verified scores, culture fit matching, B-BBEE reporting.<br><br><strong>Startup R2,999/mo</strong> — up to 50 employees<br><strong>Growth R8,999/mo</strong> — up to 250 employees<br><strong>Enterprise</strong> — custom<br><br><a href='company.html'>Company page</a> · <a href='https://calendar.app.google/8rH6YNECjxm9k96Y6' target='_blank'>Book a demo</a>" },

    { keywords: ['culture', 'culture fit'],
      a: "Culture fit is calibrated to <em>your</em> company, not a generic template. Here's how:<br><br><strong>1. Calibration workshop</strong> — we sit with your leadership and identify the values, working styles, and outcomes that define a high-performing hire at your business (2-3 hour session).<br><br><strong>2. Reference profile</strong> — we score your top 5-10 existing performers on the same dimensions to establish a baseline.<br><br><strong>3. Candidate scoring</strong> — every applicant is scored against your calibrated profile using OCEAN personality dimensions, values alignment, and behavioural signals from their interview responses.<br><br><strong>4. Match report</strong> — you get a percentage fit plus 3 specific reasons why (or why not). Never a black-box number.<br><br>You control the criteria. You can retune the calibration any time. <a href='culture-fit.html'>See how it works</a>" },

    { keywords: ['contact', 'talk', 'sales', 'support', 'help', 'email'],
      a: "Best ways to reach us:<br><br><strong>Email:</strong> <a href='mailto:enterprise@kth-tech.com'>enterprise@kth-tech.com</a><br><strong>Demo:</strong> <a href='https://calendar.app.google/8rH6YNECjxm9k96Y6' target='_blank'>Book a call</a><br><br>We reply within one business day." },

    { keywords: ['job', 'match', 'search', 'vacan'],
      a: "The Job Dashboard aggregates roles from Pnet, CareerJunction, LinkedIn, and Indeed SA, plus 24+ global markets. AI ranks by real fit, not just keywords. <a href='job-search.html'>See how it works</a>." },

    { keywords: ['cancel', 'refund'],
      a: "Cancel any month-to-month plan from your account settings — no calls, no forms. Full refund available within 7 business days (ECT Act §44 cooling-off). Beyond that, email <a href='mailto:billing@calibr-careers.tech'>billing@calibr-careers.tech</a>." },

    { keywords: ['who', 'what is', 'about', 'founder', 'karli', 'kth'],
      a: "CALIBR is built by <strong>KTH Projects (Pty) Ltd t/a KTH-Tech</strong> (Reg 2025/627290/07). Founder and Information Officer: Karli Thebe. Based in Gauteng. Mission: fix hiring, cybersecurity, and AI adoption in South Africa — built for us, in Rand, POPIA-first." },

    { keywords: ['course', 'training', 'academy', 'certif', 'learn', 'seta', 'aws', 'microsoft', 'azure'],
      a: "The CALIBR Academy runs 12 certification-aligned courses:<br><br><strong>Microsoft:</strong> AI-900, AI-102, AZ-900, DP-900, SC-900, MS-4013 Copilot<br><strong>AWS:</strong> AIF-C01 AI Practitioner, MLA-C01 ML Engineer, CLF-C02 Cloud<br><strong>CALIBR:</strong> Prompt Engineering, POPIA for Practitioners, GenAI for Leaders<br><br>From R1,999 per learner. MICT SETA accreditation in application (Q3 2027).<br><br><a href='ai-readiness.html'>Browse the catalogue</a>" },

    { keywords: ['sign up', 'signup', 'register', 'get started', 'start', 'enrol'],
      a: "Two paths:<br><br><strong>Individual</strong> — <a href='pricing.html'>see plans</a><br><strong>Company</strong> — <a href='contact.html'>book a demo call</a><br><br>Both include a 14-day free trial, no card required upfront." },

    { keywords: ['thank', 'thanks', 'ta', 'appreciate'],
      a: "Anytime. Anything else?" },

    { keywords: ['hi', 'hello', 'hey', 'howzit', 'yo', 'sup'],
      a: "Hi. Ask me anything about CALIBR — pricing, security, courses, hiring." }
  ];

  var FALLBACKS = [
    "That's outside my wheelhouse. Try asking about pricing, security, courses, or hiring — or email <a href='mailto:enterprise@kth-tech.com'>enterprise@kth-tech.com</a> for a human.",
    "I don't have a clean answer for that. Rephrase, or email <a href='mailto:enterprise@kth-tech.com'>enterprise@kth-tech.com</a>.",
    "Not sure. Try again with different wording, or reach a human at <a href='mailto:enterprise@kth-tech.com'>enterprise@kth-tech.com</a>."
  ];

  var QUICK = ['Pricing', 'Culture Fit', 'Security & POPIA', 'Courses', 'Book a Demo'];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function findAnswer(q) {
    var lower = q.toLowerCase();
    for (var i = 0; i < KB.length; i++) {
      for (var j = 0; j < KB[i].keywords.length; j++) {
        if (lower.indexOf(KB[i].keywords[j]) !== -1) return KB[i].a;
      }
    }
    return pick(FALLBACKS);
  }

  // ─────────────────────────────────────────────
  //  Cali monogram — just typography, no icon
  // ─────────────────────────────────────────────
  function monogram() {
    return '<span style="font-weight:900;font-size:15px;color:#FFF;letter-spacing:-0.02em">C</span>';
  }

  function build() {
    var path = (location.pathname || '').toLowerCase();
    if (path.indexOf('demo-') !== -1) return;

    // Inject styles
    var css = document.createElement('style');
    css.textContent =
      '#cali-fab{position:fixed;bottom:20px;right:20px;width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#FF1B8D,#A855F7);color:#FFF;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(255,27,141,0.4);display:flex;align-items:center;justify-content:center;font-family:inherit;transition:all 0.2s;z-index:900}' +
      '#cali-fab:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(255,27,141,0.55)}' +
      '#cali-fab.open{transform:rotate(45deg);background:#0A0A0A;box-shadow:0 8px 24px rgba(0,0,0,0.25)}' +
      '#cali-fab .lbl{font-weight:900;font-size:16px;letter-spacing:-0.02em}' +
      '#cali-fab.open .lbl{content:"×"}' +
      '@media(max-width:900px){#cali-fab{bottom:88px;right:16px}}' +
      '#cali-panel{position:fixed;bottom:84px;right:20px;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#FFF;border:1px solid #EAEAEA;border-radius:20px;box-shadow:0 24px 60px rgba(0,0,0,0.18);display:none;flex-direction:column;overflow:hidden;z-index:899;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif}' +
      '#cali-panel.open{display:flex;animation:cali-in 0.2s cubic-bezier(0.22,1,0.36,1)}' +
      '@keyframes cali-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
      '@media(max-width:900px){#cali-panel{bottom:152px;right:16px}}' +
      '#cali-head{padding:20px 20px 16px;border-bottom:1px solid #F0F0F0;display:flex;align-items:center;gap:12px}' +
      '#cali-head .avatar{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#FF1B8D,#A855F7);display:flex;align-items:center;justify-content:center;color:#FFF;font-weight:900;font-size:15px;letter-spacing:-0.02em;flex-shrink:0}' +
      '#cali-head .who{flex:1;min-width:0}' +
      '#cali-head .name{font-size:14px;font-weight:800;color:#0A0A0A;letter-spacing:-0.01em;display:flex;align-items:center;gap:8px}' +
      '#cali-head .name::after{content:"";width:6px;height:6px;border-radius:50%;background:#10B981}' +
      '#cali-head .role{font-size:11px;color:#6B7280;font-weight:500;margin-top:2px}' +
      '#cali-head .close{background:transparent;border:none;color:#6B7280;font-size:18px;cursor:pointer;padding:6px;border-radius:6px;line-height:1;font-family:inherit}' +
      '#cali-head .close:hover{background:#F5F5F5;color:#0A0A0A}' +
      '#cali-msgs{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:12px}' +
      '.cali-msg{max-width:88%;padding:12px 14px;border-radius:14px;font-size:13.5px;line-height:1.55}' +
      '.cali-msg.bot{background:#F5F5F7;color:#0A0A0A;border-bottom-left-radius:4px;align-self:flex-start}' +
      '.cali-msg.user{background:#0A0A0A;color:#FFF;border-bottom-right-radius:4px;align-self:flex-end}' +
      '.cali-msg a{color:#FF1B8D;font-weight:700;text-decoration:underline}' +
      '.cali-typing{display:flex;gap:4px;padding:12px 14px;background:#F5F5F7;border-radius:14px;border-bottom-left-radius:4px;align-self:flex-start;width:fit-content}' +
      '.cali-typing span{width:6px;height:6px;border-radius:50%;background:#A855F7;animation:cali-dot 1.2s infinite ease-in-out}' +
      '.cali-typing span:nth-child(2){animation-delay:0.15s}' +
      '.cali-typing span:nth-child(3){animation-delay:0.3s}' +
      '@keyframes cali-dot{0%,60%,100%{opacity:0.3;transform:scale(0.8)}30%{opacity:1;transform:scale(1)}}' +
      '#cali-quick{padding:10px 20px 8px;border-top:1px solid #F0F0F0;display:flex;flex-wrap:wrap;gap:6px}' +
      '.cali-chip{padding:7px 12px;background:#FFF;border:1px solid #EAEAEA;color:#0A0A0A;border-radius:99px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s}' +
      '.cali-chip:hover{border-color:#FF1B8D;color:#FF1B8D}' +
      '#cali-form{display:flex;gap:8px;padding:12px 20px 16px;border-top:1px solid #F0F0F0;background:#FFF}' +
      '#cali-input{flex:1;padding:12px 14px;font-size:13px;font-family:inherit;background:#F5F5F7;border:1px solid transparent;border-radius:10px;color:#0A0A0A;outline:none;transition:all 0.15s}' +
      '#cali-input:focus{background:#FFF;border-color:#FF1B8D;box-shadow:0 0 0 3px rgba(255,27,141,0.12)}' +
      '#cali-input::placeholder{color:#9CA3AF}' +
      '#cali-send{padding:12px 18px;background:#0A0A0A;color:#FFF;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.02em;transition:background 0.15s}' +
      '#cali-send:hover{background:#FF1B8D}';
    document.head.appendChild(css);

    var fab = document.createElement('button');
    fab.id = 'cali-fab';
    fab.setAttribute('aria-label', 'Chat with Cali');
    fab.innerHTML = '<span class="lbl">C</span>';
    document.body.appendChild(fab);

    var panel = document.createElement('div');
    panel.id = 'cali-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Cali — CALIBR assistant');
    panel.innerHTML =
      '<div id="cali-head">' +
        '<div class="avatar">C</div>' +
        '<div class="who"><div class="name">Cali</div><div class="role">CALIBR assistant · online</div></div>' +
        '<button class="close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div id="cali-msgs"></div>' +
      '<div id="cali-quick"></div>' +
      '<form id="cali-form">' +
        '<input id="cali-input" type="text" placeholder="Ask about pricing, security, courses…" autocomplete="off">' +
        '<button id="cali-send" type="submit">Send</button>' +
      '</form>';
    document.body.appendChild(panel);

    var msgs = document.getElementById('cali-msgs');
    var quick = document.getElementById('cali-quick');
    var form = document.getElementById('cali-form');
    var input = document.getElementById('cali-input');
    var closeBtn = panel.querySelector('.close');
    var fabLbl = fab.querySelector('.lbl');

    function addMsg(text, who) {
      var b = document.createElement('div');
      b.className = 'cali-msg ' + who;
      b.innerHTML = text;
      msgs.appendChild(b);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function addTyping() {
      var t = document.createElement('div');
      t.className = 'cali-typing';
      t.innerHTML = '<span></span><span></span><span></span>';
      msgs.appendChild(t);
      msgs.scrollTop = msgs.scrollHeight;
      return t;
    }

    function renderQuick() {
      quick.innerHTML = '';
      QUICK.forEach(function (label) {
        var c = document.createElement('button');
        c.type = 'button';
        c.className = 'cali-chip';
        c.textContent = label;
        c.addEventListener('click', function () { ask(label); });
        quick.appendChild(c);
      });
    }

    function ask(text) {
      addMsg(text, 'user');
      var typing = addTyping();
      setTimeout(function () {
        typing.remove();
        addMsg(findAnswer(text), 'bot');
      }, 500 + Math.random() * 350);
    }

    function open() {
      panel.classList.add('open');
      fab.classList.add('open');
      fabLbl.textContent = '×';
      if (!msgs.children.length) { addMsg(pick(GREETINGS), 'bot'); renderQuick(); }
      setTimeout(function () { input.focus(); }, 100);
    }
    function close() {
      panel.classList.remove('open');
      fab.classList.remove('open');
      fabLbl.textContent = 'C';
    }

    fab.addEventListener('click', function () { panel.classList.contains('open') ? close() : open(); });
    closeBtn.addEventListener('click', close);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!v) return;
      ask(v);
      input.value = '';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
