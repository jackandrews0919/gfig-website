/* ================================================================
   GFIG — Mission Board JS (missions.js)
   Filtering, searching, modal, claim logic
   ================================================================ */

let currentMissionData = {};

/* ── Mission type → class mapping ── */
function getClassFromType(typeStr) {
  const t = typeStr.toLowerCase();
  if (t.includes('ils') || t.includes('localizer') || t.includes('glide slope')) return 'a';
  if (t.includes('vor') || t.includes('ndb') || t.includes('survey') || t.includes('dme')) return 'b';
  if (t.includes('approach') || t.includes('rnav') || t.includes('rnp')) return 'c';
  if (t.includes('procedure') || t.includes('sid') || t.includes('star') || t.includes('advanced')) return 'd';
  if (t.startsWith('spy-') || t.includes('surveillance') || t.includes('patrol') || t.includes('coastal') || t.includes('border')) return 'f';
  if (t.startsWith('heli-') || t.includes('aerial') || t.includes('media') || t.includes('event coverage') || t.includes('news')) return 'g';
  if (t.startsWith('uas-') || t.includes('drone') || t.includes('geospatial') || t.includes('precision survey')) return 'h';
  return 'e'; // traffic, flight test, low vis, steep, departure, sensor, ovp
}

// ── Filter missions ──────────────────────────────────────────────
function applyFilters() {
  const search   = (document.getElementById('mission-search')?.value || '').toLowerCase();
  const region   = document.getElementById('filter-region')?.value || '';
  const type     = document.getElementById('filter-type')?.value || '';
  const priority = document.getElementById('filter-priority')?.value || '';
  const status   = document.getElementById('filter-status')?.value || '';
  const mClass   = document.getElementById('filter-class')?.value || '';

  const TYPE_CLASS = { ils:'a', vor:'b', ndb:'b', survey:'b', approach:'c', procedure:'d' };

  const cards = document.querySelectorAll('#mission-grid .mission-card');
  let visible = 0;

  cards.forEach(card => {
    const cardRegion   = card.dataset.region   || '';
    const cardType     = card.dataset.type     || '';
    const cardPriority = card.dataset.priority || '';
    const cardStatus   = card.dataset.status   || '';
    const cardText     = card.textContent.toLowerCase();
    const cardClass    = cardType.startsWith('ovp-') ? 'e'
                       : cardType.startsWith('spy-') ? 'f'
                       : cardType.startsWith('heli-') ? 'g'
                       : cardType.startsWith('uas-') ? 'h'
                       : (TYPE_CLASS[cardType] || '');

    const matchSearch   = !search   || cardText.includes(search);
    const matchRegion   = !region   || cardRegion   === region;
    const matchType     = !type     || cardType     === type;
    const matchPriority = !priority || cardPriority === priority;
    const matchStatus   = !status   || cardStatus   === status;
    const matchClass    = !mClass   || cardClass    === mClass;

    const show = matchSearch && matchRegion && matchType && matchPriority && matchStatus && matchClass;
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  const countEl = document.getElementById('mission-count');
  if (countEl) countEl.textContent = `Showing ${visible} mission${visible !== 1 ? 's' : ''}`;
}

function resetFilters() {
  ['filter-region', 'filter-type', 'filter-priority', 'filter-status', 'filter-class'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const search = document.getElementById('mission-search');
  if (search) search.value = '';
  applyFilters();
}

// ── View toggle ──────────────────────────────────────────────────
function setView(type) {
  const grid = document.getElementById('mission-grid');
  const btnGrid = document.getElementById('view-grid');
  const btnList = document.getElementById('view-list');

  if (type === 'grid') {
    grid.className = 'grid-auto animate-stagger';
    if (btnGrid) { btnGrid.style.color = 'var(--blue-light)'; btnGrid.style.borderColor = 'var(--blue)'; }
    if (btnList) { btnList.style.color = ''; btnList.style.borderColor = ''; }
  } else {
    grid.style.display = 'flex';
    grid.style.flexDirection = 'column';
    grid.style.gap = '10px';
    if (btnList) { btnList.style.color = 'var(--blue-light)'; btnList.style.borderColor = 'var(--blue)'; }
    if (btnGrid) { btnGrid.style.color = ''; btnGrid.style.borderColor = ''; }
  }
}

// ── Mission Modal ────────────────────────────────────────────────
function openMissionModal(id, dep, arr, type, priority, aircraft, region, brief) {
  currentMissionData = { id, dep, arr, type, priority, aircraft, region, brief };

  document.getElementById('modal-id').textContent = id;
  document.getElementById('modal-title').textContent = 'Mission Brief — ' + type;
  document.getElementById('modal-route').textContent = dep + '  →  ' + arr;
  document.getElementById('modal-brief').textContent = brief;

  const detailsEl = document.getElementById('modal-details');
  const priorityClass = priority.toLowerCase() === 'urgent' ? 'badge-urgent' : priority.toLowerCase() === 'priority' ? 'badge-priority' : 'badge-routine';

  const missionClass = getClassFromType(type);
  const classInfo = {
    a: { label: 'Class A — ILS Calibration', color: 'var(--pass)'    },
    b: { label: 'Class B — VOR / NDB',       color: 'var(--blue)'    },
    c: { label: 'Class C — RNAV',            color: 'var(--monitor)' },
    d: { label: 'Class D — Advanced',        color: 'var(--danger)'  },
    e: { label: 'Class E — OVP',             color: '#8891f5'        },
    f: { label: 'Class F — Surveillance',    color: '#f4c430'        },
    g: { label: 'Class G — Aerial Media',    color: '#26c6da'        },
    h: { label: 'Class H — UAS Survey',      color: '#66bb6a'        }
  }[missionClass] || { label: 'Standard', color: 'var(--text-sub)' };

  detailsEl.innerHTML = `
    <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">Aircraft</div><div style="font-family:var(--font-mono); font-size:0.9rem; color:var(--text);">${aircraft}</div></div>
    <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">Region</div><div style="font-size:0.9rem; color:var(--text);">${region}</div></div>
    <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">Priority</div><div><span class="badge ${priorityClass}">${priority}</span></div></div>
    <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">Classification</div><div style="font-family:var(--font-mono); font-size:0.78rem; color:${classInfo.color};">${classInfo.label}</div></div>
  `;

  /* Show relevant specialist notice, hide all others */
  const ovpNotice  = document.getElementById('modal-ovp-notice');
  const spyNotice  = document.getElementById('modal-spy-notice');
  const heliNotice = document.getElementById('modal-heli-notice');
  const uasNotice  = document.getElementById('modal-uas-notice');
  if (ovpNotice)  ovpNotice.style.display  = missionClass === 'e' ? 'block' : 'none';
  if (spyNotice)  spyNotice.style.display  = missionClass === 'f' ? 'block' : 'none';
  if (heliNotice) heliNotice.style.display = missionClass === 'g' ? 'block' : 'none';
  if (uasNotice)  uasNotice.style.display  = missionClass === 'h' ? 'block' : 'none';

  document.getElementById('mission-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMissionModal() {
  document.getElementById('mission-modal').classList.remove('open');
  document.body.style.overflow = '';
  currentMissionData = {};
}

function confirmClaim() {
  const { id, dep, arr, type } = currentMissionData;
  closeMissionModal();
  showToast(`✓ Mission ${id} claimed — ${dep} → ${arr} · ${type}. Brief posted to #mission-briefing on Discord.`, 'success');

  // Update the card's claim button
  document.querySelectorAll('.mission-card').forEach(card => {
    if (card.textContent.includes(id)) {
      const claimBtn = card.querySelector('.btn-primary');
      const badge = card.querySelector('.badge-available');
      if (claimBtn) { claimBtn.textContent = '✓ Claimed'; claimBtn.disabled = true; claimBtn.className = 'btn btn-sm btn-success'; claimBtn.style.cursor = 'default'; }
      if (badge) { badge.className = 'badge badge-active'; badge.textContent = 'In Progress'; }
    }
  });
}

function claimMission(id) {
  const user = gfigAuth.getUser();
  if (!user) { showToast('You must be logged in to claim a mission.', 'error'); return; }

  /* Optimistically update UI */
  const card = [...document.querySelectorAll('.mission-card')]
    .find(c => c.querySelector('.mission-id')?.textContent === id);
  if (card) {
    const btn   = card.querySelector('.btn-primary');
    const badge = card.querySelector('.badge-available');
    if (btn)   { btn.textContent = 'Claiming…'; btn.disabled = true; }
    if (badge) { badge.className = 'badge badge-active'; badge.textContent = 'In Progress'; }
  }

  dbClaimMission(id, user).then(ok => {
    if (ok) {
      showToast(`✓ Mission ${id} claimed! Brief posted to #mission-briefing on Discord.`, 'success');
      if (card) {
        const btn = card.querySelector('.btn-primary, .btn-success');
        if (btn) { btn.textContent = '✓ Claimed'; btn.className = 'btn btn-sm btn-success'; btn.style.cursor = 'default'; }
      }
    } else {
      /* Revert UI on failure */
      if (card) {
        const btn   = card.querySelector('.btn-success, .btn-primary');
        const badge = card.querySelector('.badge-active');
        if (btn)   { btn.textContent = 'Claim Mission'; btn.className = 'btn btn-sm btn-primary'; btn.disabled = false; }
        if (badge) { badge.className = 'badge badge-available'; badge.textContent = 'Available'; }
      }
    }
  });
}

// ── Confirm claim from modal ─────────────────────────────────────
function confirmClaim() {
  const { id, dep, arr, type } = currentMissionData;
  closeMissionModal();
  claimMission(id);
  /* Card UI revert handled inside claimMission */
  document.querySelectorAll('.mission-card').forEach(card => {
    if (card.querySelector('.mission-id')?.textContent === id) {
      const btn   = card.querySelector('.btn-primary');
      const badge = card.querySelector('.badge-available');
      if (btn)   { btn.textContent = 'Claiming…'; btn.disabled = true; btn.className = 'btn btn-sm btn-success'; }
      if (badge) { badge.className = 'badge badge-active'; badge.textContent = 'In Progress'; }
    }
  });
}

// ── Load More ────────────────────────────────────────────────────
function loadMoreMissions() {
  showToast('Loading additional missions…', 'info');
}

// ── Wire up filters ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  ['mission-search', 'filter-region', 'filter-type', 'filter-priority', 'filter-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', applyFilters), el.addEventListener('change', applyFilters);
  });

  // Close modal on overlay click
  const overlay = document.getElementById('mission-modal');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeMissionModal();
    });
  }

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMissionModal();
  });
});

/* ── Dynamic mission loading from Firestore ─────────────────────
   When Firebase is configured, replace static HTML cards with live
   data from the missions collection. Falls back to static HTML.    */
document.addEventListener('gfig:authready', () => {
  if (!window.db) {
    applyFilters(); // count static cards
    return;
  }

  const grid = document.getElementById('mission-grid');
  if (!grid) return;

  /* Show loading state */
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-muted);font-family:var(--font-head);font-size:0.8rem;letter-spacing:0.1em;">LOADING MISSIONS…</div>';

  dbGetMissions().then(missions => {
    if (!missions || !missions.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-muted);">No active missions at this time.</div>';
      return;
    }

    grid.innerHTML = '';
    missions.forEach(m => {
      if (m.status === 'expired') return;
      const isActive = m.status === 'active';
      const priorityClass = m.priority === 'Urgent' ? 'badge-urgent' : m.priority === 'Priority' ? 'badge-priority' : 'badge-routine';
      const statusClass   = isActive ? 'badge-active' : 'badge-available';
      const statusLabel   = isActive ? 'In Progress' : 'Available';
      const btnHtml = isActive
        ? `<button class="btn btn-sm btn-secondary" disabled>Claimed</button>`
        : `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); claimMission('${m.id}')">Claim Mission</button>`;

      const typeKey = (m.type || '').toLowerCase()
        .replace(/\s+/g,'').replace('calibration','').replace('check','').replace('validation','').replace('survey','survey').replace('approach','approach').replace('procedure','procedure');
      const dataType = m.dataType || (m.type || '').toLowerCase().split(' ')[0];

      const card = document.createElement('div');
      card.className = 'mission-card';
      card.dataset.region   = (m.region || '').toLowerCase().replace(/\s+/g,'');
      card.dataset.type     = dataType;
      card.dataset.priority = (m.priority || 'routine').toLowerCase();
      card.dataset.status   = m.status || 'available';
      card.onclick = () => openMissionModal(m.id, m.dep, m.arr, m.type, m.priority, m.aircraft, m.region, m.brief || '');
      card.innerHTML = `
        <div class="mission-card-header">
          <div>
            <div class="mission-id">${m.id}</div>
            <div class="mission-route">${m.dep} <span class="mission-route-arrow">→</span> ${m.arr}</div>
          </div>
          <span class="badge ${priorityClass}">${m.priority || 'Routine'}</span>
        </div>
        <div class="text-sm text-sub">${m.type || '—'}</div>
        <div class="mission-details">
          <div><div class="mission-detail-label">Aircraft</div><div class="mission-detail-val font-mono">${m.aircraft || '—'}</div></div>
          <div><div class="mission-detail-label">Region</div><div class="mission-detail-val">${m.region || '—'}</div></div>
          <div><div class="mission-detail-label">Est. Time</div><div class="mission-detail-val">${m.estTime || '—'}</div></div>
          <div><div class="mission-detail-label">Points</div><div class="mission-detail-val text-pass">+${m.points || 120} pts</div></div>
        </div>
        <div class="mission-card-footer">
          <span class="badge ${statusClass}">${statusLabel}${isActive && m.claimedByName ? ' · ' + m.claimedByName : ''}</span>
          ${btnHtml}
        </div>
      `;
      grid.appendChild(card);
    });

    // Update header count
    const available = missions.filter(m => m.status === 'available').length;
    const active    = missions.filter(m => m.status === 'active').length;
    const liveEl    = document.querySelector('.live-dot');
    if (liveEl) liveEl.textContent = `${available} Available`;
    const activeBadge = document.querySelector('.badge-active:not(.mission-card .badge-active)');
    if (activeBadge && activeBadge.textContent.includes('In Progress')) activeBadge.textContent = `${active} In Progress`;

    applyFilters();
  }).catch(e => {
    console.error('Mission load error:', e);
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--fail);">Error loading missions. Please refresh.</div>';
  });
});
