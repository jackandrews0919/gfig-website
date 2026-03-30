/* ================================================================
   GFIG — Dashboard JS (dashboard.js)
   Live activity feed refresh, metric animations
   ================================================================ */

// ── Animate metric counter ───────────────────────────────────────
function animateCounter(el, target, prefix = '', suffix = '') {
  const start = 0;
  const duration = 1200;
  const startTime = performance.now();
  const isFloat = String(target).includes('.');

  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const value = isFloat ? (start + (target - start) * ease).toFixed(1) : Math.round(start + (target - start) * ease);
    el.textContent = prefix + value.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ── Animate all metric values on page load ───────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const metricValues = document.querySelectorAll('.metric-value');
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const raw = el.textContent.trim();
        // parse numeric from things like "4,820" or "96.2%" or "47"
        const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
        const suffix = raw.replace(/[0-9,. ]/g, '');
        if (!isNaN(num)) animateCounter(el, num, '', suffix);
        obs.unobserve(el);
      }
    });
  }, { threshold: 0.5 });
  metricValues.forEach(el => obs.observe(el));
});

// ── Simulated live activity feed ticker ─────────────────────────
const liveEvents = [
  { type: 'pass',    text: '<strong>CPT Wright</strong> completed GFI-2026-0287 — Airport Survey YSSY→YMML', time: 'Just now' },
  { type: 'active',  text: '<strong>INS Santos</strong> started mission GFI-2026-0293 — NDB Calibration LEMD→LEBL', time: 'Just now' },
  { type: 'pass',    text: '<strong>SR. INS Okonkwo</strong> completed GFI-2026-0292 — VOR Check OMDB→OTHH', time: '2 min ago' },
  { type: 'monitor', text: '<strong>INS Park</strong> filed MONITOR result on GFI-2026-0288 — Minor bearing deviation noted', time: '5 min ago' },
  { type: 'active',  text: '<strong>DIR Chen</strong> claimed GFI-2026-0294 — ILS CAT-III Special Inspection ZBAA', time: '8 min ago' },
];

let eventIndex = 0;

function addActivityItem(event) {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;

  const item = document.createElement('div');
  item.className = 'activity-item';
  item.style.animation = 'slideIn 0.3s ease';
  item.innerHTML = `
    <div class="activity-dot ${event.type}"></div>
    <div>
      <div class="activity-text">${event.text}</div>
      <div class="activity-time">${new Date().toISOString().slice(11,16)} UTC · ${event.time}</div>
    </div>
  `;
  feed.insertBefore(item, feed.firstChild);

  // Keep only 8 items
  const items = feed.querySelectorAll('.activity-item');
  if (items.length > 8) items[items.length - 1].remove();
}

// Push a new live event every 18 seconds
setInterval(() => {
  addActivityItem(liveEvents[eventIndex % liveEvents.length]);
  eventIndex++;
}, 18000);
