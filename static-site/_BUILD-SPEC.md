# CALIBR site build spec — READ AND FOLLOW EXACTLY

Rebuild pages in the CURRENT design system. Every page must be visually consistent with `index.html` and `pricing.html`.

## Non-negotiables
- **Palette**: black `#000000`, white `#FFFFFF`, hot pink `#FF1F70`. Defined as CSS vars in `css/style.css` (`--ink`, `--paper`, `--pink`). Use the vars/classes — never hardcode other colours.
- **Font**: Inter only (loaded via the Google Fonts link in <head> and the shared CSS). No other fonts.
- **Stylesheet**: link `css/style.css?v=7`. Do NOT write your own big `<style>` block — use the shared component classes. Small page-specific inline style is OK only if a component truly doesn't exist.
- **JS**: end body with `<script src="js/main.js?v=7"></script>`.
- **No emoji. No grey text. No italics** (the `<em>` tag is used but renders upright hot-pink via the CSS — keep using `<em>` for accent words).
- **Naming**: display the entity as **"KTH-Tech"** everywhere EXCEPT the legal pages (privacy.html, terms.html) which must use the full registered name **"KTH Projects (Pty) Ltd t/a KTH-Tech"**.
- **Pricing (locked)**: Individuals R199 / R349 / R499 per month. Employers R1,499/mo + success fee **from 2%**. Enterprise on consultation. Academy = **Coming soon (Q1 2027)**.
- **Statuses**: all product tools are **Live** except **CALIBR Academy** which is **Coming soon**.
- **Booking link** (use for all "Book a call" / demo / talk-to-sales CTAs): `https://calendar.app.google/8rH6YNECjxm9k96Y6` (open in new tab: `target="_blank" rel="noopener"`).
- **Reg**: 2025/627290/07 · Gauteng, South Africa · enterprise@kth-tech.com · calibr-careers.tech

## Available component classes (in css/style.css)
- `.nav .logo .mark .wm` — top nav (copy the exact HEAD + NAV + FOOTER blocks below verbatim)
- `.page-hero` with `.eyebrow`, `h1` (use `<em>` for a hot-pink accent word), `.lede`, `.hero-cta`
- `.section` (add `.dark` for black bg or `.pink` for hot-pink bg); wrap dark/pink section content in `.section-in`
- `.section-head` with `.section-lbl` + `.lede`
- `.grid-2` / `.grid-3` / `.grid-4` of `.card` (variants `.card.light`, `.card.coral`). Card has optional `.num`, `h3` (with `<em>.</em>`), `p`, `ul>li>strong+span`, and a `.cta` link.
- `.price-grid` of `.tier` (variants `.tier.dark`, `.tier.coral`) — `h3`, `.t-price`, `.t-per`, `ul>li`, `.t-cta`; optional `.t-badge`.
- `.stats-band` of `.stat-c` (`.num` + `.lbl`) for a black stat strip.
- `.longform` wrapper for legal/policy text: `.meta`, `h2`, `h3`, `p`, `ul/ol`, `strong`, `a`.
- `.form` with `.fld` (label + input/textarea/select).
- Buttons: `.btn-p` (hot-pink), `.btn-g` (outline), `.btn-d` (black). On cards use `.cta`.
- `.reveal` on sections/cards triggers scroll-in animation. `.magnet` on buttons.

## EXACT nav to place at top of <body> on every page
```html
<header class="nav">
  <a href="index.html" class="logo">
    <span class="mark" aria-hidden="true"><span></span></span>
    <span class="wm" aria-label="Calibr"><span>C</span><span>a</span><span>l</span><span>i</span><span>b</span><span>r</span></span><em>.</em>
  </a>
  <nav class="nav-l">
    <a href="index.html#hire">Hire</a>
    <a href="index.html#grow">Grow</a>
    <a href="index.html#learn">Academy</a>
    <a href="pricing.html">Pricing</a>
    <a href="contact.html">Contact</a>
  </nav>
  <div class="nav-cta">
    <a href="contact.html" class="ghost">Contact</a>
    <a href="https://calendar.app.google/8rH6YNECjxm9k96Y6" target="_blank" rel="noopener" class="primary">Book a call</a>
  </div>
</header>
```

## EXACT <head> template (change TITLE and DESCRIPTION per page)
```html
<!DOCTYPE html>
<html lang="en-ZA">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>[PAGE TITLE] — CALIBR</title>
<meta name="description" content="[PAGE DESCRIPTION]">
<link rel="canonical" href="https://calibr-careers.tech/[FILENAME]">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><circle cx='20' cy='20' r='18' fill='%23FFFFFF' stroke='%23000000' stroke-width='2'/><line x1='20' y1='2' x2='20' y2='38' stroke='%23000000' stroke-width='1.5'/><line x1='2' y1='20' x2='38' y2='20' stroke='%23000000' stroke-width='1.5'/><circle cx='20' cy='20' r='4' fill='%23FF1F70'/></svg>">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#FF1F70">
<link rel="stylesheet" href="css/style.css?v=7">
</head>
<body>
```

## EXACT footer to place before </body> on every page (adjust `.col-lede` line per page if you like)
```html
<footer class="colophon reveal">
  <p class="col-lede">Score every candidate.<br><em>Land every role.</em></p>
  <div class="col-cta">
    <a href="https://calendar.app.google/8rH6YNECjxm9k96Y6" target="_blank" rel="noopener" class="btn-p magnet">Book a call</a>
    <a href="contact.html" class="btn-g magnet">Contact us</a>
  </div>
  <div class="col-meta">
    <div><h4>Hubs</h4><a href="index.html#hire">Hire (Employers)</a><a href="index.html#grow">Grow (Job Seekers)</a><a href="index.html#learn">Learn (Academy)</a></div>
    <div><h4>Product</h4><a href="pricing.html">Pricing</a><a href="calibr-score.html">CALIBR Score</a><a href="ai-readiness.html">AI Readiness</a><a href="cybersecurity.html">Cybersecurity</a></div>
    <div><h4>Company</h4><a href="company.html">About</a><a href="contact.html">Contact</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a></div>
    <div><h4>Entity</h4><p>KTH-Tech<br>Reg 2025/627290/07<br>Gauteng · South Africa</p></div>
  </div>
  <div class="col-foot">
    <span>© 2026 · KTH-Tech</span>
    <span>CALIBR is a product of KTH Tech · kth-tech.com</span>
  </div>
</footer>
<script src="js/main.js?v=7"></script>
</body>
</html>
```

## Product facts to draw on
- Three hubs: **Hire** (employers, from R1,499/mo + 2%), **Grow** (job seekers, from R199/mo), **Learn** (Academy, Q1 2027).
- **The CALIBR Score**: a verified, tamper-proof rating scored on the same axes for everyone — comparable, trusted. The pre-scored talent pool is the platform's moat.
- **Six assessments**: Aptitude, Technical, Personality, Culture-Fit, Integrity, Cognitive.
- **How hiring compresses 42→8 days**: AI bulk-screening, reusable Score, one calibrated interview, auto B-BBEE/EE compliance.
- **Cited SA market stats**: 46% youth unemployment (Stats SA Q1 2025), ~42-day avg time-to-hire (Genius/Payoneer), ~17% recruiter fee (APSO), R200k+ cost of a bad hire (Procompare/PCS-SA). Label as market benchmarks, not CALIBR results.
- **Compliance**: POPIA · ECT Act · CPA · B-BBEE · MICT SETA (’27) · Microsoft Partner · AWS Partner.

Write real, specific South African copy. No lorem ipsum. Each page should feel complete and considered.
