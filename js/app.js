/* ================================================================
   GFIG — Core App JS (app.js)
   Shared across all pages: nav active state, animations, utils
   ================================================================ */

// ── Mark current nav link active ────────────────────────────────
(function () {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('href') === path) {
      link.classList.add('active');
    }
  });
})();

// ── Intersection Observer for animate-in ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.feature-card, .cert-card, .course-card, .metric-card, .mission-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = 'opacity 0.4s ease, transform 0.4s ease, border-color 0.2s ease, box-shadow 0.2s ease';
    obs.observe(el);
  });
});

// ── Live clock for navbar (optional) ────────────────────────────
function updateClock() {
  const now = new Date();
  const utc = now.toISOString().slice(11, 16);
  const clockEl = document.getElementById('utc-clock');
  if (clockEl) clockEl.textContent = utc + ' UTC';
}
setInterval(updateClock, 1000);
updateClock();

// ── Utility: show toast notification ────────────────────────────
function showToast(message, type = 'info') {
  const existing = document.querySelector('.gfig-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'gfig-toast';
  const colors = { info: 'var(--active-bg)', success: 'var(--pass-bg)', warn: 'var(--monitor-bg)', error: 'var(--fail-bg)' };
  const borders = { info: 'rgba(64,170,255,0.3)', success: 'var(--pass-border)', warn: 'var(--monitor-border)', error: 'var(--fail-border)' };
  const textColors = { info: 'var(--active)', success: 'var(--pass)', warn: 'var(--monitor)', error: 'var(--fail)' };

  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: ${colors[type]}; border: 1px solid ${borders[type]};
    color: ${textColors[type]}; padding: 14px 20px;
    border-radius: 10px; font-size: 0.875rem; font-weight: 500;
    max-width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    animation: fadeInUp 0.3s ease; backdrop-filter: blur(8px);
    font-family: 'Inter', sans-serif;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 4000);
}
