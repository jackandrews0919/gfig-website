/* ================================================================
   GFIG — Mission Board JS (missions.js)
   Filtering, searching, modal, claim logic
   ================================================================ */

let currentMissionData = {};

// ── Filter missions ──────────────────────────────────────────────
function applyFilters() {
  const search   = (document.getElementById('mission-search')?.value || '').toLowerCase();
  const region   = document.getElementById('filter-region')?.value || '';
  const type     = document.getElementById('filter-type')?.value || '';
  const priority = document.getElementById('filter-priority')?.value || '';
  const status   = document.getElementById('filter-status')?.value || '';

  const cards = document.querySelectorAll('#mission-grid .mission-card');
  let visible = 0;

  cards.forEach(card => {
    const cardRegion   = card.dataset.region   || '';
    const cardType     = card.dataset.type     || '';
    const cardPriority = card.dataset.priority || '';
    const cardStatus   = card.dataset.status   || '';
    const cardText     = card.textContent.toLowerCase();

    const matchSearch   = !search   || cardText.includes(search);
    const matchRegion   = !region   || cardRegion   === region;
    const matchType     = !type     || cardType     === type;
    const matchPriority = !priority || cardPriority === priority;
    const matchStatus   = !status   || cardStatus   === status;

    const show = matchSearch && matchRegion && matchType && matchPriority && matchStatus;
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  const countEl = document.getElementById('mission-count');
  if (countEl) countEl.textContent = `Showing ${visible} mission${visible !== 1 ? 's' : ''}`;
}

function resetFilters() {
  ['filter-region', 'filter-type', 'filter-priority', 'filter-status'].forEach(id => {
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
  detailsEl.innerHTML = `
    <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">Aircraft</div><div style="font-family:var(--font-mono); font-size:0.9rem; color:var(--text);">${aircraft}</div></div>
    <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">Region</div><div style="font-size:0.9rem; color:var(--text);">${region}</div></div>
    <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">Priority</div><div><span class="badge ${priorityClass}">${priority}</span></div></div>
    <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">Type</div><div style="font-size:0.9rem; color:var(--text);">${type}</div></div>
  `;

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
