/* ================================================================
   GFIG — Dashboard JS (dashboard.js)
   • Animates metric counters on scroll
   • Loads live data from Firestore when Firebase is configured
   • Falls back to simulated activity feed when offline/demo
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
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const raw = el.textContent.trim();
        const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
        const suffix = raw.replace(/[0-9,. ]/g, '');
        if (!isNaN(num)) animateCounter(el, num, '', suffix);
        obs.unobserve(el);
      }
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.metric-value').forEach(el => obs.observe(el));
});

// ── Simulated live activity feed ticker (demo fallback) ──────────
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
  const items = feed.querySelectorAll('.activity-item');
  if (items.length > 8) items[items.length - 1].remove();
}

// ── Load live dashboard data from Firestore ──────────────────────
document.addEventListener('gfig:authready', async (e) => {
  const user = e.detail;
  if (!user) return;

  /* ── Update header greeting ── */
  const hdr = document.querySelector('.page-header p');
  if (hdr) {
    const pts    = (user.points         || 0).toLocaleString();
    const active = (user.activeMissions || 0);
    hdr.textContent = `Welcome back, ${user.name || 'Inspector'} — ${pts} inspector points.`;
  }

  /* ── Update inspector status sidebar ── */
  const avatarEl = document.querySelector('.profile-hero .profile-avatar, .card .nav-pilot .nav-avatar');
  document.querySelectorAll('.nav-avatar').forEach(el => el.textContent = user.avatar || 'IN');

  /* Status card values */
  const statMap = {
    '[data-stat="missions"]':  (user.totalMissions || 142).toLocaleString(),
    '[data-stat="passrate"]':  (user.passRate       || 96) + '%',
    '[data-stat="points"]':    (user.points         || 4820).toLocaleString(),
    '[data-stat="hours"]':     (user.flightHours    || 1246) + 'h'
  };
  Object.entries(statMap).forEach(([sel, val]) => {
    document.querySelectorAll(sel).forEach(el => el.textContent = val);
  });

  /* Progress bar */
  const rankPts   = { 'Junior Inspector': 500, 'Inspector': 1500, 'Senior Inspector': 3000, 'Chief Inspector': 6000, 'Deputy Director': 12000, 'Director': 999999 };
  const nextRanks = Object.keys(rankPts);
  const curRank   = user.rank || 'Inspector';
  const curIdx    = nextRanks.indexOf(curRank);
  const nextRank  = nextRanks[curIdx + 1] || 'Director';
  const curThresh = curIdx >= 0 ? (rankPts[curRank] || 0) : 0;
  const nxtThresh = rankPts[nextRank] || 999999;
  const pct       = Math.min(100, Math.round(((user.points || 0) - curThresh) / (nxtThresh - curThresh) * 100));
  document.querySelectorAll('.prog-bar').forEach(el => el.style.width = pct + '%');
  document.querySelectorAll('[data-next-rank]').forEach(el => el.textContent = nextRank);
  document.querySelectorAll('[data-rank-progress]').forEach(el =>
    el.textContent = `${(user.points || 0).toLocaleString()} / ${nxtThresh.toLocaleString()}`);

  if (!window.db) {
    /* Demo: keep static activity feed and push simulated events */
    setInterval(() => {
      addActivityItem(liveEvents[eventIndex % liveEvents.length]);
      eventIndex++;
    }, 18000);
    return;
  }

  /* ── Load network mission counts ── */
  try {
    const snap = await window.db.collection('missions')
      .where('status', 'in', ['available', 'active']).get();
    const available = snap.docs.filter(d => d.data().status === 'available').length;
    const active2   = snap.docs.filter(d => d.data().status === 'active').length;

    /* Metric card: Active Network Missions */
    const metricCards = document.querySelectorAll('.metric-card');
    if (metricCards[0]) {
      const valEl = metricCards[0].querySelector('.metric-value');
      if (valEl) animateCounter(valEl, available + active2);
    }
    const liveEl = document.querySelector('.page-header .live-dot');
    if (liveEl) liveEl.textContent = `Operations Live`;

    /* ── Load user's active missions metric ── */
    if (!user._isDemo) {
      const mySnap = await window.db.collection('missions')
        .where('claimedBy', '==', user.uid)
        .where('status', '==', 'active').get();
      if (metricCards[1]) {
        const valEl = metricCards[1].querySelector('.metric-value');
        if (valEl) animateCounter(valEl, mySnap.size);
      }
    }
  } catch (err) {
    console.warn('Dashboard metrics load error:', err.message);
  }

  /* ── Load live activity feed ── */
  try {
    const actItems = await dbGetActivity(8);
    if (actItems && actItems.length) {
      const feed = document.getElementById('activity-feed');
      if (feed) {
        feed.innerHTML = '';
        actItems.forEach(ev => {
          const ts = ev.timestamp?.toDate ? ev.timestamp.toDate() : new Date(ev.timestamp || Date.now());
          const timeStr = ts.toISOString().slice(11, 16) + ' UTC';
          const item = document.createElement('div');
          item.className = 'activity-item';
          item.innerHTML = `
            <div class="activity-dot ${ev.type || 'active'}"></div>
            <div>
              <div class="activity-text">${ev.text || ''}</div>
              <div class="activity-time">${timeStr}</div>
            </div>
          `;
          feed.appendChild(item);
        });
      }
    }
  } catch (err) {
    console.warn('Activity feed load error:', err.message);
  }

  /* ── Load leaderboard ── */
  try {
    const leaders = await dbGetLeaderboard(6);
    if (leaders && leaders.length) {
      const rankIcons = ['🥇', '🥈', '🥉', '4', '5', '6'];
      const lbEl = document.querySelector('.card .lb-item')?.closest('.card');
      if (lbEl) {
        const container = lbEl.querySelectorAll('.lb-item')[0]?.parentElement;
        if (container) {
          container.innerHTML = '';
          leaders.forEach((leader, i) => {
            const av   = leader.avatar || (leader.name || 'IN').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
            const isMe = leader.id === user.uid;
            const item = document.createElement('div');
            item.className = 'lb-item' + (isMe ? '' : '');
            if (isMe) item.style.cssText = 'background:rgba(0,119,255,0.05);border-radius:6px;padding:11px 6px;';
            const rankClasses = ['gold','silver','bronze','','',''];
            item.innerHTML = `
              <div class="lb-rank ${rankClasses[i] || ''}">${i + 1}</div>
              <div class="lb-avatar">${av}</div>
              <div class="lb-info">
                <div class="lb-name">${leader.name || '—'}${isMe ? ' <span class="text-xs text-muted">(you)</span>' : ''}</div>
                <div class="lb-detail">${leader.rank || 'Inspector'} · ${leader.totalMissions || 0} missions</div>
              </div>
              <div class="lb-pts">${(leader.points || 0).toLocaleString()}</div>
            `;
            container.appendChild(item);
          });
        }
      }
    }
  } catch (err) {
    console.warn('Leaderboard load error:', err.message);
  }

  /* ── Real-time activity listener: push new events live ── */
  window.db.collection('activity')
    .orderBy('timestamp', 'desc')
    .limit(1)
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const ev = change.doc.data();
          addActivityItem({ type: ev.type || 'active', text: ev.text || '', time: 'Just now' });
        }
      });
    }, () => {}); /* silence permission errors */
});
