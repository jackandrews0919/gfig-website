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

// ── Mobile hamburger menu ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });
    // Close menu when a link is tapped on mobile
    navLinks.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      }
    });
  }
});

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

// ── Inject "Tools" dropdown into nav (members only) ─────────────
(function() {
  var navLinks = document.getElementById('nav-links');
  if (!navLinks) return;
  // Don't show tools on public pages (no auth required)
  var publicPages = ['index.html','login.html','join.html','sops.html','roster.html','stats.html','404.html',''];
  var currentPage = (window.location.pathname.split('/').pop() || '').toLowerCase();
  if (publicPages.indexOf(currentPage) !== -1) return;
  var toolsPages = [
    { href:'logbook.html',           label:'📒 Logbook' },
    { href:'pireps.html',            label:'📡 PIREPs' },
    { href:'dispatch.html',          label:'📋 Dispatch' },
    { href:'weather.html',           label:'🌤 Weather' },
    { href:'fleet.html',             label:'✈ Fleet' },
    { href:'map.html',               label:'🗺 Route Map' },
    { href:'achievements.html',      label:'🏆 Achievements' },
    { href:'documents.html',         label:'📁 Documents' },
    { href:'stats.html',             label:'📊 Statistics' },
    { href:'livemap.html',           label:'📡 Live Map' },
    { href:'tours.html',             label:'🧭 Tours' },
    { href:'schedule.html',          label:'🕐 Inspection Schedule' },
    { href:'typeratings.html',       label:'📜 Type Ratings' },
    { href:'awards.html',            label:'🥇 Awards' },
    { href:'landings.html',          label:'🛬 Landings' },
    { href:'crewpairing.html',       label:'👨‍✈️ Crew Pairing' },
    { href:'mentorship.html',        label:'🎓 Mentorship' },
    { href:'codeshare.html',         label:'🤝 Codeshare' },
    { href:'forum.html',             label:'💬 Forum' },
    { href:'safety.html',            label:'🔒 Safety Reports' },
    { href:'pirepvalidation.html',   label:'✅ PIREP Validation' },
    { href:'hubs.html',              label:'🏠 Hubs' },
    { href:'notifications-settings.html', label:'🔔 Notifications' }
  ];
  // Build dropdown wrapper
  var wrap = document.createElement('div');
  wrap.className = 'nav-dropdown';
  wrap.style.cssText = 'position:relative;display:inline-block;';
  var toggle = document.createElement('a');
  toggle.className = 'nav-link';
  toggle.href = '#';
  toggle.textContent = '⊞ Tools';
  toggle.onclick = function(e) { e.preventDefault(); menu.classList.toggle('open'); };
  var menu = document.createElement('div');
  menu.className = 'nav-dropdown-menu';
  menu.style.cssText = 'display:none;position:absolute;top:100%;left:0;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:6px 0;min-width:180px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  toolsPages.forEach(function(p) {
    var a = document.createElement('a');
    a.href = p.href;
    a.textContent = p.label;
    a.style.cssText = 'display:block;padding:8px 16px;color:var(--text-sub);font-size:0.82rem;text-decoration:none;transition:background 0.15s;';
    if (p.href === currentPage) { a.style.color = 'var(--blue)'; a.classList.add('active'); toggle.style.color = 'var(--blue)'; }
    a.onmouseenter = function() { this.style.background = 'var(--bg-secondary)'; };
    a.onmouseleave = function() { this.style.background = 'none'; };
    menu.appendChild(a);
  });
  // Toggle open class
  var style = document.createElement('style');
  style.textContent = '.nav-dropdown-menu.open{display:block!important;}';
  document.head.appendChild(style);
  wrap.appendChild(toggle);
  wrap.appendChild(menu);
  // Insert before Profile link or at end
  var profileLink = navLinks.querySelector('a[href="profile.html"]');
  if (profileLink) navLinks.insertBefore(wrap, profileLink);
  else navLinks.appendChild(wrap);
  // Close on outside click
  document.addEventListener('click', function(e) { if (!wrap.contains(e.target)) menu.classList.remove('open'); });
})();

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

// ── Dark / Light Theme Toggle ───────────────────────────────────
(function() {
  // Apply saved theme immediately
  var saved = localStorage.getItem('gfig-theme');
  if (saved === 'light') document.documentElement.classList.add('light');

  document.addEventListener('DOMContentLoaded', function() {
    // Insert toggle button into nav-actions (before first child)
    var actions = document.querySelector('.nav-actions');
    if (!actions) return;
    var btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.title = 'Toggle Dark/Light Theme';
    btn.style.cssText = 'padding:5px 11px;background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-sub);font-size:0.9rem;cursor:pointer;font-family:inherit;line-height:1;';
    btn.textContent = document.documentElement.classList.contains('light') ? '🌙' : '☀';
    btn.onclick = function() {
      document.documentElement.classList.toggle('light');
      var isLight = document.documentElement.classList.contains('light');
      localStorage.setItem('gfig-theme', isLight ? 'light' : 'dark');
      btn.textContent = isLight ? '🌙' : '☀';
    };
    actions.insertBefore(btn, actions.firstChild);
  });
})();
