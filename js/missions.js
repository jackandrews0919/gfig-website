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
  // Triggered from card button directly (without opening modal)
  const card = document.querySelector(`[onclick*="${id}"]`)?.closest('.mission-card');
  if (!card) {
    confirmClaim();
    return;
  }
  const claimBtn = card.querySelector('.btn-primary');
  const badge = card.querySelector('.badge-available');
  if (claimBtn) { claimBtn.textContent = '✓ Claimed'; claimBtn.disabled = true; claimBtn.className = 'btn btn-sm btn-success'; claimBtn.style.cursor = 'default'; }
  if (badge) { badge.className = 'badge badge-active'; badge.textContent = 'In Progress'; }
  showToast(`✓ Mission ${id} claimed! Mission brief posted to #mission-briefing on Discord.`, 'success');
}

// ── Load More ────────────────────────────────────────────────────
function loadMoreMissions() {
  showToast('Loading additional missions… (full backend required for live data)', 'info');
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
