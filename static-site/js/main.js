// Reveal on scroll
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// Magnetic buttons
document.querySelectorAll('.magnet').forEach(btn => {
  btn.addEventListener('mousemove', e => {
    const r = btn.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    btn.style.transform = `translate(${x * 0.15}px, ${y * 0.25}px)`;
  });
  btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
});

// Count-up
function countUp(el){
  const target = parseInt(el.dataset.count, 10);
  const prefix = el.dataset.prefix || '';
  const suffix = el.dataset.suffix || '';
  const duration = 1400;
  const start = performance.now();
  function step(now){
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = Math.round(target * eased);
    el.textContent = prefix + val + suffix;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
setTimeout(() => {
  document.querySelectorAll('[data-count]').forEach(el => countUp(el));
}, 1300);

// Live tag morph
setTimeout(() => {
  document.querySelectorAll('.live-tag').forEach(el => {
    el.style.transition = 'opacity 0.3s ease';
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = el.dataset.to; el.style.opacity = '1'; }, 300);
  });
}, 2600);

// Kinetic word rotator — "Score it" flips to beige to stand out
const HILITE = { 'Score it': 'var(--paper)' };
function colorWord(el, word){ el.style.color = HILITE[word.trim()] || ''; }
document.querySelectorAll('.kinetic').forEach((wrap, wi) => {
  const words = wrap.dataset.words.split(',');
  let i = 0;
  colorWord(wrap.querySelector('.k'), words[0]);
  setInterval(() => {
    const cur = wrap.querySelector('.k');
    cur.classList.remove('in'); cur.classList.add('out');
    setTimeout(() => {
      i = (i + 1) % words.length;
      cur.textContent = words[i];
      colorWord(cur, words[i]);
      cur.classList.remove('out');
      cur.getBoundingClientRect();
      cur.classList.add('in');
    }, 450);
  }, 2400 + wi * 200);
});
