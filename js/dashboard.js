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
    '[data-stat="missions"]':  (user.totalMissions || 0).toLocaleString(),
    '[data-stat="passrate"]':  user.passRate != null ? user.passRate + '%' : '—',
    '[data-stat="points"]':    (user.points   || 0).toLocaleString(),
    '[data-stat="hours"]':     user.flightHours != null ? user.flightHours + 'h' : '—'
  };
  Object.entries(statMap).forEach(([sel, val]) => {
    document.querySelectorAll(sel).forEach(el => el.textContent = val);
  });

  /* Sidebar status card identity */
  const dashName = document.getElementById('dash-status-name');
  const dashCallsign = document.getElementById('dash-status-callsign');
  const dashRankBadge = document.getElementById('dash-status-rank-badge');
  if (dashName) dashName.textContent = user.name || 'Inspector';
  if (dashCallsign) dashCallsign.textContent = user.callsign || '—';
  if (dashRankBadge) { dashRankBadge.textContent = user.rank || 'Trainee Inspector'; dashRankBadge.className = 'rank-badge'; }

  /* Branch badge */
  const dashBranchBadge = document.getElementById('dash-status-branch-badge');
  if (dashBranchBadge && window.getBranchInfo) {
    const bi = window.getBranchInfo(user.branch || 'GFIG');
    dashBranchBadge.textContent = bi.icon + ' ' + bi.short;
    dashBranchBadge.className = 'branch-badge branch-' + bi.id.toLowerCase();
  }

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

    /* Render live missions preview table */
    const liveBody = document.getElementById('live-missions-tbody');
    if (liveBody) {
      const top5 = snap.docs.slice(0, 5);
      liveBody.innerHTML = top5.length ? top5.map(d => {
        const m = d.data();
        const pri = m.priority === 'urgent' ? 'badge-urgent' : m.priority === 'priority' ? 'badge-priority' : 'badge-routine';
        const sts = m.status === 'active' ? 'badge-active' : 'badge-available';
        const act = m.status === 'available'
          ? `<a href="missions.html" class="btn btn-xs btn-primary">Claim</a>`
          : `<a href="#" class="btn btn-xs btn-secondary">Brief</a>`;
        return `<tr><td class="td-mono">${m.missionId||d.id}</td><td><span class="td-route">${m.departure||'—'} <span class="td-route-arrow">→</span> ${m.destination||m.icao||'—'}</span></td><td>${m.type||m.missionType||'—'}</td><td><span class="badge ${pri}">${m.priority||'Routine'}</span></td><td><span class="badge ${sts}">${m.status==='active'?'In Progress':'Available'}</span></td><td class="${m.status==='active'?'text-sm':'text-muted text-sm'}">${m.claimedByName||'—'}</td><td>${act}</td></tr>`;
      }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);font-family:var(--font-head);font-size:0.78rem;letter-spacing:0.08em;padding:20px;">NO ACTIVE MISSIONS</td></tr>';
    }

    /* ── Load user’s active missions metric ── */
    if (!user._isDemo) {
      const mySnap = await window.db.collection('missions')
        .where('claimedBy', '==', user.uid)
        .where('status', '==', 'active').get();
      if (metricCards[1]) {
        const valEl = metricCards[1].querySelector('.metric-value');
        if (valEl) animateCounter(valEl, mySnap.size);
      }
      /* Render my active missions table */
      const myBody  = document.getElementById('my-missions-tbody');
      const myBadge = document.getElementById('my-missions-badge');
      if (myBadge) myBadge.textContent = mySnap.size + ' Active';
      if (myBody) {
        myBody.innerHTML = mySnap.size ? mySnap.docs.map(d => {
          const m = d.data(); const pending = m.reportPending;
          return `<tr><td class="td-mono">${m.missionId||d.id}</td><td><span class="td-route">${m.departure||'—'} <span class="td-route-arrow">→</span> ${m.destination||m.icao||'—'}</span></td><td>${m.type||m.missionType||'—'}</td><td><span class="badge ${pending?'badge-pending':'badge-active'}">${pending?'Report Due':'Flying'}</span></td><td>${pending?`<a href="report.html" class="btn btn-xs btn-warn">Submit Report</a>`:`<a href="#" class="btn btn-xs btn-secondary">Track</a>`}</td></tr>`;
        }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);font-family:var(--font-head);font-size:0.78rem;letter-spacing:0.08em;padding:20px;">NO ACTIVE MISSIONS</td></tr>';
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
    } else {
      const feedEl = document.getElementById('activity-feed');
      if (feedEl) feedEl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-family:var(--font-head);font-size:0.78rem;letter-spacing:0.08em;">NO RECENT ACTIVITY</div>';
    }
  } catch (err) {
    console.warn('Activity feed load error:', err.message);
  }

  /* ── Load leaderboard ── */
  var _allLeaders = [];
  try {
    const leaders = await dbGetLeaderboard(30);
    _allLeaders = leaders || [];
    renderLeaderboard(_allLeaders, 'all', user);
  } catch (err) {
    console.warn('Leaderboard load error:', err.message);
  }

  /* Branch switching */
  window._dashboardLeaders = _allLeaders;
  window._dashboardUser = user;
  window.switchLeaderboard = function(branch, btn) {
    document.querySelectorAll('.lb-tab').forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    renderLeaderboard(window._dashboardLeaders, branch, window._dashboardUser);
  };

  function renderLeaderboard(allLeaders, branch, currentUser) {
    var filtered = branch === 'all' ? allLeaders : allLeaders.filter(function(l) { return (l.branch || 'GFIG') === branch; });
    filtered = filtered.slice(0, 6);
    var lbList = document.getElementById('leaderboard-list');
    if (!lbList) return;
    if (!filtered.length) {
      lbList.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-family:var(--font-head);font-size:0.78rem;letter-spacing:0.08em;">NO DATA YET</div>';
      return;
    }
    lbList.innerHTML = '';
    filtered.forEach(function(leader, i) {
      var av   = leader.avatar || (leader.name || 'IN').split(' ').map(function(w) { return w[0]; }).join('').slice(0,2).toUpperCase();
      var isMe = leader.id === currentUser.uid;
      var item = document.createElement('div');
      item.className = 'lb-item';
      if (isMe) item.style.cssText = 'background:rgba(0,119,255,0.05);border-radius:6px;padding:11px 6px;';
      var rankClasses = ['gold','silver','bronze','','',''];
      var bi = window.getBranchInfo ? window.getBranchInfo(leader.branch) : null;
      var branchTag = bi ? ' <span class="branch-badge branch-' + bi.id.toLowerCase() + '" style="font-size:0.6rem;padding:1px 6px;">' + bi.icon + '</span>' : '';
      item.innerHTML = '<div class="lb-rank ' + (rankClasses[i] || '') + '">' + (i + 1) + '</div>'
        + '<div class="lb-avatar">' + av + '</div>'
        + '<div class="lb-info">'
        + '<div class="lb-name">' + (leader.name || '—') + branchTag + (isMe ? ' <span class="text-xs text-muted">(you)</span>' : '') + '</div>'
        + '<div class="lb-detail">' + (leader.rank || 'Inspector') + ' · ' + (leader.totalMissions || 0) + ' missions</div>'
        + '</div>'
        + '<div class="lb-pts">' + (leader.points || 0).toLocaleString() + '</div>';
      lbList.appendChild(item);
    });
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

  /* ── Load Wallet / Economy ── */
  try {
    var wallet = window.dbGetWallet ? await window.dbGetWallet(user.uid) : null;
    if (wallet) {
      var balBadge = document.getElementById('wallet-balance-badge');
      var earnedEl = document.getElementById('wallet-earned');
      var spentEl  = document.getElementById('wallet-spent');
      if (balBadge) balBadge.textContent = 'G$ ' + (wallet.balance || 0).toLocaleString();
      if (earnedEl) earnedEl.textContent = 'G$ ' + (wallet.totalEarned || 0).toLocaleString();
      if (spentEl)  spentEl.textContent  = 'G$ ' + (wallet.totalSpent  || 0).toLocaleString();
    }
    var txns = window.dbGetTransactions ? await window.dbGetTransactions(user.uid, 8) : [];
    var txnList = document.getElementById('wallet-transactions');
    if (txnList) {
      if (txns.length) {
        txnList.innerHTML = '';
        txns.forEach(function(tx) {
          var isCredit = tx.type === 'credit';
          var div = document.createElement('div');
          div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--bg-secondary);border-radius:var(--r-sm);font-size:0.75rem;';
          div.innerHTML = '<span style="color:var(--text-sub);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (tx.reason || (isCredit ? 'Revenue' : 'Expense')) + '</span>'
            + '<span style="font-weight:700;color:' + (isCredit ? 'var(--pass)' : 'var(--danger)') + ';white-space:nowrap;margin-left:8px;">'
            + (isCredit ? '+' : '-') + ' G$ ' + (tx.amount || 0).toLocaleString() + '</span>';
          txnList.appendChild(div);
        });
      } else {
        txnList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:12px;font-size:0.78rem;">No transactions yet — complete a mission to earn G-Credits!</div>';
      }
    }
  } catch(e) { console.warn('Wallet load error:', e.message); }
});
