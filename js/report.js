/* ================================================================
   GFIG — Report Submission JS (report.js)
   Multi-step form logic, validation, mission data pre-fill
   ================================================================ */

let currentStep = 1;

const missionData = {
  'GFI-2026-0285': { route: 'EGKK → EIDW', type: 'ILS Calibration', aircraft: 'A320', callsign: 'GFIG42I', region: 'Europe', priority: 'Priority' },
  'GFI-2026-0283': { route: 'EGCC → EGGD', type: 'VOR Check',        aircraft: 'B737', callsign: 'GFIG42V', region: 'Europe', priority: 'Routine' },
  'GFI-2026-0281': { route: 'EDDF → EDDM', type: 'Procedure Validation', aircraft: 'A320', callsign: 'GFIG42P', region: 'Europe', priority: 'Routine' },
};

// ── Step navigation ──────────────────────────────────────────────
function goToStep(n) {
  if (n > currentStep && !validateStep(currentStep)) return;

  document.getElementById('step-' + currentStep).classList.add('hidden');
  currentStep = n;
  document.getElementById('step-' + currentStep).classList.remove('hidden');
  updateStepIndicators();

  if (n === 4) buildReview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepIndicators() {
  for (let i = 1; i <= 4; i++) {
    const ind = document.getElementById('step-ind-' + i);
    if (!ind) continue;
    const numDiv = ind.querySelector('div');
    if (i < currentStep) {
      ind.style.color = 'var(--pass)';
      if (numDiv) { numDiv.style.background = 'var(--pass)'; numDiv.style.color = '#000'; numDiv.textContent = '✓'; numDiv.style.borderColor = 'transparent'; }
    } else if (i === currentStep) {
      ind.style.color = 'var(--blue-light)';
      if (numDiv) { numDiv.style.background = 'var(--blue)'; numDiv.style.color = '#fff'; numDiv.textContent = i; numDiv.style.border = 'none'; }
    } else {
      ind.style.color = 'var(--text-muted)';
      if (numDiv) { numDiv.style.background = 'var(--bg-card)'; numDiv.style.color = 'var(--text-muted)'; numDiv.textContent = i; numDiv.style.border = '1px solid var(--border)'; }
    }
  }
}

// ── Step validation ──────────────────────────────────────────────
function validateStep(n) {
  if (n === 1) {
    const sel = document.getElementById('mission-select');
    if (!sel.value) { showToast('Please select a mission', 'warn'); return false; }
  }
  if (n === 2) {
    const required = ['flight-date', 'flight-time', 'block-off', 'block-on', 'cruise-alt', 'airspeed', 'atc-contact', 'network'];
    for (const id of required) {
      const el = document.getElementById(id);
      if (!el || !el.value) { showToast('Please fill in all flight data fields', 'warn'); el?.focus(); return false; }
    }
  }
  if (n === 3) {
    const result = document.querySelector('input[name="result"]:checked');
    if (!result) { showToast('Please select an inspection result (PASS / MONITOR / FAIL)', 'warn'); return false; }
    const obs = document.getElementById('observations');
    if (result.value !== 'pass' && obs.value.trim().length < 50) {
      showToast('MONITOR and FAIL results require at least 50 characters in observations', 'warn');
      obs.focus();
      return false;
    }
  }
  return true;
}

// ── Mission selection ────────────────────────────────────────────
function populateMissionData(missionId) {
  const nextBtn = document.getElementById('step1-next');
  const infoCard = document.getElementById('mission-info-card');

  if (!missionId || !missionData[missionId]) {
    nextBtn.disabled = true;
    infoCard.classList.add('hidden');
    return;
  }

  const data = missionData[missionId];
  document.getElementById('info-route').textContent = data.route;
  document.getElementById('info-type').textContent = data.type;
  document.getElementById('info-aircraft').textContent = data.aircraft;
  document.getElementById('info-callsign').textContent = data.callsign;
  document.getElementById('info-region').textContent = data.region;

  const priorityEl = document.getElementById('info-priority');
  priorityEl.className = 'badge ' + (data.priority === 'Urgent' ? 'badge-urgent' : data.priority === 'Priority' ? 'badge-priority' : 'badge-routine');
  priorityEl.textContent = data.priority;

  infoCard.classList.remove('hidden');
  nextBtn.disabled = false;
}

// ── Show/hide fail action field ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[name="result"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const failWrap = document.getElementById('fail-action-wrap');
      if (radio.value === 'fail' && radio.checked) {
        failWrap.style.display = '';
      } else {
        failWrap.style.display = 'none';
      }
    });
  });

  // Set today's date as default
  const dateField = document.getElementById('flight-date');
  if (dateField) {
    const today = new Date().toISOString().split('T')[0];
    dateField.value = today;
    dateField.max = today;
  }
});

// ── Build review panel ───────────────────────────────────────────
function buildReview() {
  const missionId = document.getElementById('mission-select')?.value;
  const data = missionData[missionId] || {};
  const result = document.querySelector('input[name="result"]:checked')?.value || '—';
  const obs = document.getElementById('observations')?.value || '';
  const narrative = document.getElementById('narrative')?.value || '';
  const date = document.getElementById('flight-date')?.value || '';
  const blockOff = document.getElementById('block-off')?.value || '';
  const blockOn = document.getElementById('block-on')?.value || '';
  const alt = document.getElementById('cruise-alt')?.value || '';
  const spd = document.getElementById('airspeed')?.value || '';
  const network = document.getElementById('network')?.value || '';
  const atc = document.getElementById('atc-contact')?.value || '';

  const resultBadge = result === 'pass' ? '<span class="badge badge-pass" style="font-size:0.9rem; padding:5px 14px;">✓ PASS</span>'
    : result === 'monitor' ? '<span class="badge badge-monitor" style="font-size:0.9rem; padding:5px 14px;">◉ MONITOR</span>'
    : result === 'fail' ? '<span class="badge badge-fail" style="font-size:0.9rem; padding:5px 14px;">✗ FAIL</span>'
    : '—';

  document.getElementById('review-content').innerHTML = `
    <div style="background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--r-lg); padding:22px; margin-bottom:20px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
        <div>
          <div style="font-family:var(--font-mono); font-size:0.78rem; color:var(--blue-light); margin-bottom:4px;">${missionId}</div>
          <div style="font-family:var(--font-head); font-size:1.4rem; font-weight:700; letter-spacing:0.06em;">${data.route || '—'}</div>
        </div>
        <div style="text-align:right;">${resultBadge}</div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-bottom:16px;">
        <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Type</div><div style="font-size:0.85rem;">${data.type || '—'}</div></div>
        <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Aircraft</div><div style="font-size:0.85rem; font-family:var(--font-mono);">${data.aircraft || '—'}</div></div>
        <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Date</div><div style="font-size:0.85rem;">${date}</div></div>
        <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Block Off</div><div style="font-size:0.85rem; font-family:var(--font-mono);">${blockOff} UTC</div></div>
        <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Block On</div><div style="font-size:0.85rem; font-family:var(--font-mono);">${blockOn} UTC</div></div>
        <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Network</div><div style="font-size:0.85rem;">${network.toUpperCase()}</div></div>
        <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Cruise Alt</div><div style="font-size:0.85rem; font-family:var(--font-mono);">${Number(alt).toLocaleString()} ft</div></div>
        <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">IAS</div><div style="font-size:0.85rem; font-family:var(--font-mono);">${spd} kts</div></div>
        <div><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">ATC Contact</div><div style="font-size:0.85rem;">${atc}</div></div>
      </div>
      <div style="border-top:1px solid var(--border); padding-top:14px; margin-top:4px;">
        <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px;">Technical Observations</div>
        <div style="font-size:0.85rem; color:var(--text-sub); line-height:1.6;">${obs || '(none provided)'}</div>
      </div>
      ${narrative ? `<div style="border-top:1px solid var(--border); padding-top:14px; margin-top:14px;"><div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px;">Flight Narrative</div><div style="font-size:0.85rem; color:var(--text-sub); line-height:1.6;">${narrative}</div></div>` : ''}
    </div>
  `;
}

// ── Submit report ────────────────────────────────────────────────
function submitReport(e) {
  e.preventDefault();
  if (!validateStep(3)) return;

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  // Simulate submission delay
  setTimeout(() => {
    document.getElementById('report-form-wrap').classList.add('hidden');
    const banner = document.getElementById('success-banner');
    banner.classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth' });
    showToast('✓ Report submitted! Posted to #inspection-reports on Discord.', 'success');
  }, 1400);
}
