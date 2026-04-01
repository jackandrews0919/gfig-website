/* ================================================================
   GFIG — Database Access Layer (db.js)
   Firestore CRUD for missions, reports, NOTAMs, applications,
   users, and activity feed.
   Falls back gracefully to localStorage/static HTML when Firebase
   is not configured.
   ================================================================ */

/* ══════════════════════════════════════════════════════════════
   UTILITY
   ══════════════════════════════════════════════════════════════ */

function _nextIdNum(lastId, regex) {
  if (!lastId) return 1;
  const m = lastId.match(regex);
  return m ? (parseInt(m[1], 10) + 1) : 1;
}

/* ══════════════════════════════════════════════════════════════
   MISSIONS
   ══════════════════════════════════════════════════════════════ */

/** Load all (or a filtered subset of) missions from Firestore.
 *  Returns null when Firebase is not configured (callers use static HTML). */
window.dbGetMissions = async function(filters = {}) {
  if (!window.db) return null;
  try {
    let q = window.db.collection('missions');
    if (filters.status) q = q.where('status', '==', filters.status);
    const snap = await q.orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('dbGetMissions:', e.message);
    return null;
  }
};

/** Load missions claimed by a specific user (by uid or callsign) */
window.dbGetMyMissions = async function(uid) {
  if (!window.db || !uid) return null;
  try {
    const snap = await window.db.collection('missions')
      .where('claimedBy', '==', uid)
      .where('status', 'in', ['active', 'completed'])
      .orderBy('claimedAt', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('dbGetMyMissions:', e.message);
    return null;
  }
};

/** Atomically claim a mission (prevents double-claims via transaction) */
window.dbClaimMission = async function(missionId, user) {
  if (!window.db) {
    showToast(`✓ Mission ${missionId} claimed! (Demo — not persisted)`, 'success');
    return true;
  }
  const ref = window.db.collection('missions').doc(missionId);
  try {
    await window.db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists)                      throw new Error('Mission not found.');
      if (doc.data().status !== 'available') throw new Error('This mission has already been claimed.');
      tx.update(ref, {
        status:         'active',
        claimedBy:      user.uid || user.callsign || 'unknown',
        claimedByName:  user.name || 'Inspector',
        claimedAt:      window.serverTimestamp()
      });
    });
    await dbLogActivity('active',
      `<strong>${user.name}</strong> claimed mission ${missionId}`);
    return true;
  } catch (e) {
    showToast(e.message || 'Error claiming mission.', 'error');
    return false;
  }
};

/** Create a new mission (admin) — includes auto-generated mission brief */
window.dbCreateMission = async function(data) {
  if (!window.db) {
    showToast('Mission created. (Demo — not persisted to database)', 'success');
    return 'DEMO-' + Date.now();
  }
  try {
    const snap = await window.db.collection('missions')
      .orderBy('createdAt', 'desc').limit(1).get();
    const lastId = snap.empty ? '' : (snap.docs[0].data().id || '');
    const nextNum = _nextIdNum(lastId, /(\d{4})$/);
    const year = new Date().getFullYear();
    const missionId = `GFI-${year}-${String(nextNum).padStart(4, '0')}`;

    // Auto-generate mission brief
    const brief = _generateMissionBrief(missionId, data);

    await window.db.collection('missions').doc(missionId).set({
      ...data,
      id:            missionId,
      status:        'available',
      claimedBy:     null,
      claimedByName: null,
      claimedAt:     null,
      brief:         brief,
      createdAt:     window.serverTimestamp()
    });
    await dbLogActivity('active', `Admin created mission <strong>${missionId}</strong>`);
    return missionId;
  } catch (e) {
    console.error('dbCreateMission:', e);
    throw e;
  }
};

/** Generate a structured mission briefing document */
function _generateMissionBrief(missionId, data) {
  var icao = data.icao || '????';
  var nav  = data.nav || data.runway || 'N/A';
  var type = data.type || 'Flight Inspection';
  var cls  = data.missionClass || 'Class A';
  var aircraft = data.aircraft || 'King Air B200';
  var region   = data.region || 'Global';
  var priority = data.priority || 'Standard';
  var points   = data.points || 120;
  var now = new Date();
  var expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  return {
    missionId:   missionId,
    title:       type + ' — ' + icao + ' ' + nav,
    issuedDate:  now.toISOString().split('T')[0],
    expiryDate:  expires.toISOString().split('T')[0],
    classification: cls,
    priority:    priority,
    summary:     type + ' at ' + icao + ' (' + nav + '). ' + region + ' region. Aircraft: ' + aircraft + '.',
    sections: [
      { heading: 'OBJECTIVE', content: 'Perform ' + type.toLowerCase() + ' of ' + nav + ' at ' + icao + '. Verify signal accuracy, alignment, and compliance with ICAO Annex 10 standards.' },
      { heading: 'AIRCRAFT & EQUIPMENT', content: aircraft + ' equipped with standard GFIG flight inspection suite. Ensure all calibration equipment is serviceable before departure.' },
      { heading: 'ROUTE', content: 'Depart ' + icao + ' — conduct inspection orbits as per ' + cls + ' procedures — return to ' + icao + '.' },
      { heading: 'WEATHER REQUIREMENTS', content: priority === 'Urgent — ATC Hold' ? 'Proceed regardless of weather conditions — ATC hold in effect.' : 'VMC or IMC conditions acceptable. Minimum visibility: 3 SM for visual orbits.' },
      { heading: 'COMMUNICATIONS', content: 'Contact local ATC on arrival. State callsign and "Flight Inspection" on initial contact. Monitor guard frequency 121.5 MHz.' },
      { heading: 'REPORTING', content: 'Submit inspection report via GFIG portal within 24 hours of completion. Include all data recordings and any discrepancies noted.' }
    ],
    points: points,
    region: region
  };
}

/** Mark a mission as expired (admin) */
window.dbExpireMission = async function(missionId) {
  if (!window.db) return;
  await window.db.collection('missions').doc(missionId).update({ status: 'expired' });
};

/* ══════════════════════════════════════════════════════════════
   AUTO-GENERATOR & ILS RECURRING SCHEDULE
   ══════════════════════════════════════════════════════════════ */

const _MISSION_POOL = [
  // ── Class A · ILS Calibration ───────────────────────────────
  { icao:'EGLL', nav:'RWY 27R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Europe',        missionClass:'A', points:120 },
  { icao:'EGLL', nav:'RWY 09R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Europe',        missionClass:'A', points:120 },
  { icao:'EDDM', nav:'RWY 08R', type:'ILS Calibration', aircraft:'King Air 350ER (Class A/B)', region:'Europe',        missionClass:'A', points:120 },
  { icao:'EHAM', nav:'RWY 06',  type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Europe',        missionClass:'A', points:120 },
  { icao:'LFPG', nav:'RWY 09L', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Europe',        missionClass:'A', points:120 },
  { icao:'LEMD', nav:'RWY 32L', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Europe',        missionClass:'A', points:120 },
  { icao:'EGCC', nav:'RWY 05R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Europe',        missionClass:'A', points:120 },
  { icao:'LSZH', nav:'RWY 14',  type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Europe',        missionClass:'A', points:120 },
  { icao:'KJFK', nav:'RWY 13R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'North America', missionClass:'A', points:120 },
  { icao:'KLAX', nav:'RWY 24R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'North America', missionClass:'A', points:120 },
  { icao:'KORD', nav:'RWY 10C', type:'ILS Calibration', aircraft:'King Air 350ER (Class A/B)', region:'North America', missionClass:'A', points:120 },
  { icao:'CYYZ', nav:'RWY 06L', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'North America', missionClass:'A', points:120 },
  { icao:'KATL', nav:'RWY 08R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'North America', missionClass:'A', points:120 },
  { icao:'KMIA', nav:'RWY 09',  type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'North America', missionClass:'A', points:120 },
  { icao:'OMDB', nav:'RWY 30L', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Middle East',   missionClass:'A', points:130 },
  { icao:'OERK', nav:'RWY 15R', type:'ILS Calibration', aircraft:'King Air 350ER (Class A/B)', region:'Middle East',   missionClass:'A', points:130 },
  { icao:'RJTT', nav:'RWY 22',  type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Asia-Pacific',  missionClass:'A', points:130 },
  { icao:'YSSY', nav:'RWY 16R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Asia-Pacific',  missionClass:'A', points:130 },
  { icao:'ZSPD', nav:'RWY 17L', type:'ILS Calibration', aircraft:'King Air 350ER (Class A/B)', region:'Asia-Pacific',  missionClass:'A', points:130 },
  { icao:'WSSS', nav:'RWY 03C', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Asia-Pacific',  missionClass:'A', points:130 },
  { icao:'FAOR', nav:'RWY 03L', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Africa',        missionClass:'A', points:130 },
  { icao:'HECA', nav:'RWY 05R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Africa',        missionClass:'A', points:130 },
  { icao:'SBGR', nav:'RWY 10R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Latin America', missionClass:'A', points:130 },
  { icao:'MMMX', nav:'RWY 23L', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Latin America', missionClass:'A', points:130 },
  { icao:'SCEL', nav:'RWY 17R', type:'ILS Calibration', aircraft:'King Air B200 (Class A/B)',  region:'Latin America', missionClass:'A', points:130 },
  // ── Class B · VOR / NDB ─────────────────────────────────────
  { icao:'LSZH', nav:'VOR ZUE', type:'VOR Check',       aircraft:'King Air B200 (Class A/B)', region:'Europe',        missionClass:'B', points:100 },
  { icao:'EGPD', nav:'VOR ADN', type:'VOR Check',       aircraft:'King Air B200 (Class A/B)', region:'Europe',        missionClass:'B', points:100 },
  { icao:'CYYZ', nav:'VOR YYZ', type:'VOR Check',       aircraft:'King Air B200 (Class A/B)', region:'North America', missionClass:'B', points:100 },
  { icao:'KEWR', nav:'VOR EWR', type:'VOR Check',       aircraft:'King Air B200 (Class A/B)', region:'North America', missionClass:'B', points:100 },
  { icao:'RJTT', nav:'VOR OKO', type:'VOR Check',       aircraft:'King Air B200 (Class A/B)', region:'Asia-Pacific',  missionClass:'B', points:100 },
  { icao:'OMDB', nav:'VOR DXB', type:'VOR Check',       aircraft:'King Air B200 (Class A/B)', region:'Middle East',   missionClass:'B', points:100 },
  { icao:'HECA', nav:'VOR CAI', type:'VOR Check',       aircraft:'King Air B200 (Class A/B)', region:'Africa',        missionClass:'B', points:100 },
  { icao:'FAOR', nav:'NDB AA',  type:'NDB Calibration', aircraft:'King Air B200 (Class A/B)', region:'Africa',        missionClass:'B', points:100 },
  // ── Class C · RNAV / Approach ───────────────────────────────
  { icao:'EGLL', nav:'RNP AR 27R',  type:'RNAV / RNP Check',    aircraft:'Falcon 20 (Class C/D)',     region:'Europe',        missionClass:'C', points:140 },
  { icao:'KJFK', nav:'RNAV 13R',    type:'RNAV / RNP Check',    aircraft:'Falcon 20 (Class C/D)',     region:'North America', missionClass:'C', points:140 },
  { icao:'YSSY', nav:'RNAV 34L',    type:'Approach Validation', aircraft:'Learjet 60XR (Class A/C)', region:'Asia-Pacific',  missionClass:'C', points:140 },
  { icao:'SCEL', nav:'RNAV 17R',    type:'Approach Validation', aircraft:'Falcon 20 (Class C/D)',     region:'Latin America', missionClass:'C', points:140 },
  { icao:'OMDB', nav:'RNP AR 30L',  type:'RNAV / RNP Check',    aircraft:'Learjet 60XR (Class A/C)', region:'Middle East',   missionClass:'C', points:140 },
  // ── Class D · Procedure Validation ──────────────────────────
  { icao:'EDDM', nav:'SID BETOS1G', type:'Procedure Validation', aircraft:'Citation CJ4 (Class C/D)', region:'Europe',        missionClass:'D', points:160 },
  { icao:'KLAX', nav:'STAR ANGG4',  type:'Procedure Validation', aircraft:'Citation CJ4 (Class C/D)', region:'North America', missionClass:'D', points:160 },
  { icao:'WSSS', nav:'SID BUNTO9D', type:'Procedure Validation', aircraft:'Citation CJ4 (Class C/D)', region:'Asia-Pacific',  missionClass:'D', points:160 },
  { icao:'OMDB', nav:'SID RIDAP2M', type:'Procedure Validation', aircraft:'Citation CJ4 (Class C/D)', region:'Middle East',   missionClass:'D', points:160 },
];

/** Auto-generate N missions from the built-in pool */
window.dbAutoGenerateMissions = async function(count, opts) {
  count = parseInt(count, 10) || 5;
  opts  = opts || {};
  if (!window.db) throw new Error('Not connected');
  let pool = _MISSION_POOL.slice();
  if (opts.region && opts.region !== 'All Regions') pool = pool.filter(m => m.region === opts.region);
  if (opts.type   && opts.type   !== 'All Types')   pool = pool.filter(m => m.type   === opts.type);
  if (!pool.length) throw new Error('No missions match the selected filters');
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const ids = [];
  for (const m of pool.slice(0, Math.min(count, pool.length))) {
    const id = await dbCreateMission({
      icao:         m.icao,
      nav:          m.nav,
      title:        m.icao + ' ' + m.nav,
      dep:          m.icao,
      arr:          m.icao,
      type:         m.type,
      aircraft:     m.aircraft,
      region:       m.region,
      priority:     opts.priority || 'Standard',
      points:       m.points,
      missionClass: 'Class ' + m.missionClass,
      autoGenerated: true
    });
    ids.push(id);
  }
  return ids;
};

/** Get / seed the ILS recurring schedule */
window.dbGetILSSchedule = async function() {
  if (!window.db) return [];
  try {
    const snap = await window.db.collection('ils_schedule').get();
    if (snap.empty) {
      // Seed on first call
      const ilsEntries = _MISSION_POOL.filter(m => m.type === 'ILS Calibration');
      const batch = window.db.batch();
      ilsEntries.forEach(m => {
        const docId = m.icao + '-' + m.nav.replace(/\s+/g, '');
        batch.set(window.db.collection('ils_schedule').doc(docId), {
          id: docId, icao: m.icao, nav: m.nav, region: m.region,
          aircraft: m.aircraft, points: m.points,
          lastCompleted: null, lastResult: null, nextDue: null, activeMissionId: null
        }, { merge: true });
      });
      await batch.commit();
      return ilsEntries.map(m => ({
        id: m.icao + '-' + m.nav.replace(/\s+/g,''), icao: m.icao, nav: m.nav,
        region: m.region, aircraft: m.aircraft, points: m.points,
        lastCompleted: null, lastResult: null, nextDue: null, activeMissionId: null
      }));
    }
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { console.warn('dbGetILSSchedule:', e); return []; }
};

/** Check schedule and create missions for overdue airports (nextDue <= now, no active mission) */
window.dbCheckILSSchedule = async function() {
  if (!window.db) throw new Error('Not connected');
  const schedule = await dbGetILSSchedule();
  const now = Date.now();
  let generated = 0;
  for (const entry of schedule) {
    if (entry.activeMissionId) continue;
    let due = entry.nextDue;
    if (due && typeof due === 'object' && due.toMillis) due = due.toMillis();
    if (!due || due > now) continue; // null = never scheduled; skip
    const tmpl = _MISSION_POOL.find(m => m.type === 'ILS Calibration' && m.icao === entry.icao && m.nav === entry.nav);
    if (!tmpl) continue;
    try {
      const missionId = await dbCreateMission({
        icao: entry.icao, nav: entry.nav,
        title: entry.icao + ' ' + entry.nav,
        dep: entry.icao, arr: entry.icao,
        type: 'ILS Calibration', aircraft: tmpl.aircraft,
        region: tmpl.region, priority: 'High Priority',
        points: tmpl.points, missionClass: 'Class A',
        isRecurringILS: true, ilsScheduleId: entry.id
      });
      await window.db.collection('ils_schedule').doc(entry.id).update({ activeMissionId: missionId });
      generated++;
    } catch(e) { console.warn('ILS check create failed:', entry.id, e); }
  }
  return generated;
};

/** Called inside dbSubmitReport when an ILS inspection result arrives */
async function _handleILSReport(missionId, result, icao, nav) {
  if (!window.db || !icao || !nav) return;
  try {
    const ilsId  = icao + '-' + nav.replace(/\s+/g, '');
    const now    = Date.now();
    const next90 = now + 90 * 24 * 60 * 60 * 1000; // +90 days
    if (result === 'pass') {
      await window.db.collection('ils_schedule').doc(ilsId).set({
        lastCompleted: window.serverTimestamp(), lastResult: 'pass',
        nextDue: next90, activeMissionId: null
      }, { merge: true });
    } else {
      // fail or monitor — set nextDue = now so it's immediately overdue
      await window.db.collection('ils_schedule').doc(ilsId).set({
        lastCompleted: window.serverTimestamp(), lastResult: result,
        nextDue: now, activeMissionId: null
      }, { merge: true });
      // Auto-create re-inspection mission
      const tmpl = _MISSION_POOL.find(m => m.type === 'ILS Calibration' && m.icao === icao);
      if (tmpl) {
        const newId = await dbCreateMission({
          icao: icao, nav: nav,
          title: icao + ' ' + nav + ' [RE-INSPECT]',
          dep: icao, arr: icao,
          type: 'ILS Calibration', aircraft: tmpl.aircraft,
          region: tmpl.region, priority: 'Urgent — ATC Hold',
          points: tmpl.points + 20, missionClass: 'Class A',
          isRecurringILS: true, ilsScheduleId: ilsId,
          reInspection: true, failedReportId: missionId
        });
        await window.db.collection('ils_schedule').doc(ilsId).update({ activeMissionId: newId });
        await dbLogActivity('fail',
          'ILS re-inspection auto-generated for <strong>' + icao + ' ' + nav + '</strong> after ' + result.toUpperCase());
      }
    }
  } catch(e) { console.warn('_handleILSReport:', e); }
}

/* ══════════════════════════════════════════════════════════════
   REPORTS
   ══════════════════════════════════════════════════════════════ */

/** Submit a flight inspection report */
window.dbSubmitReport = async function(reportData) {
  const user = gfigAuth.getUser();

  if (!window.db) {
    /* Demo mode — save locally so report.js success screen still works */
    const reports = JSON.parse(localStorage.getItem('gfig_reports') || '[]');
    reports.unshift({ ...reportData, id: 'RPT-' + Date.now(),
      submittedAt: new Date().toISOString(), status: 'pending' });
    localStorage.setItem('gfig_reports', JSON.stringify(reports));
    showToast('✓ Report saved (Demo — not pushed to server)', 'success');
    return 'demo-report-' + Date.now();
  }

  const ref = window.db.collection('reports').doc();
  const doc = {
    ...reportData,
    submittedBy:          user?.uid          || 'unknown',
    submittedByName:      user?.name         || 'Inspector',
    submittedByCallsign:  user?.callsign     || '',
    submittedAt:          window.serverTimestamp(),
    status:               'pending'
  };
  await ref.set(doc);

  /* Mark mission completed */
  if (reportData.missionId) {
    await window.db.collection('missions').doc(reportData.missionId).update({
      status:       'completed',
      completedAt:  window.serverTimestamp(),
      result:       reportData.result
    }).catch(() => {});
  }

  /* ILS recurring schedule hook — auto-updates schedule and re-creates on fail */
  if (reportData.missionId) {
    try {
      const mDoc = await window.db.collection('missions').doc(reportData.missionId).get();
      if (mDoc.exists) {
        const mData = mDoc.data();
        if (mData.type === 'ILS Calibration') {
          await _handleILSReport(reportData.missionId, reportData.result, mData.icao, mData.nav || mData.runway);
        }
      }
    } catch(e) { console.warn('ILS hook:', e); }
  }

  /* Award points & update user stats */
  const pts = { pass: 120, monitor: 80, fail: 40 };
  if (user?.uid && !user._isDemo) {
    await window.db.collection('users').doc(user.uid).update({
      totalMissions: window.increment(1),
      points:        window.increment(pts[reportData.result] || 120)
    }).catch(() => {});
    /* Check and unlock milestone awards */
    try { await window.dbCheckAndUnlockAwards(user.uid); } catch(e) {}
  }

  /* Activity log */
  const lbl = { pass: 'PASS ✓', monitor: 'MONITOR ◉', fail: 'FAIL ✗' }[reportData.result] || reportData.result;
  await dbLogActivity(reportData.result,
    `<strong>${user?.name}</strong> filed ${lbl} on ${reportData.missionId}`);

  /* Discord webhook */
  const settings = await window.getSettings();
  if (settings.webhookCompleted) {
    const colors = { pass: 3066993, monitor: 15105570, fail: 15158332 };
    await window.sendWebhook(settings.webhookCompleted, null, [{
      title:       `Inspection Report — ${reportData.missionId}`,
      color:       colors[reportData.result] || 3447003,
      description: (reportData.observations || '').slice(0, 400),
      fields: [
        { name: 'Inspector', value: user?.name  || '—',                      inline: true },
        { name: 'Route',     value: reportData.missionRoute || '—',           inline: true },
        { name: 'Type',      value: reportData.missionType  || '—',           inline: true },
        { name: 'Result',    value: lbl,                                       inline: true },
        { name: 'Network',   value: (reportData.network || '—').toUpperCase(), inline: true },
        { name: 'Date',      value: reportData.flightDate   || '—',           inline: true }
      ],
      footer:    { text: 'GFIG Inspection Reports' },
      timestamp: new Date().toISOString()
    }]);
  }

  return ref.id;
};

/** Get reports (optionally filtered) */
window.dbGetReports = async function(filters = {}) {
  if (!window.db) return JSON.parse(localStorage.getItem('gfig_reports') || '[]');
  try {
    let q = window.db.collection('reports');
    if (filters.submittedBy) q = q.where('submittedBy',  '==', filters.submittedBy);
    if (filters.status)      q = q.where('status',       '==', filters.status);
    const snap = await q.orderBy('submittedAt', 'desc').limit(filters.limit || 100).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

/** Review a report (admin — mark as reviewed) */
window.dbReviewReport = async function(reportId, action) {
  if (!window.db) return;
  await window.db.collection('reports').doc(reportId).update({
    status:     action,
    reviewedAt: window.serverTimestamp()
  });
};

/* ══════════════════════════════════════════════════════════════
   NOTAMs
   ══════════════════════════════════════════════════════════════ */

/** Get all active NOTAMs; returns null if Firebase not configured */
window.dbGetNotams = async function() {
  if (!window.db) return null;
  try {
    const snap = await window.db.collection('notams')
      .where('active', '==', true)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('dbGetNotams:', e.message);
    return null;
  }
};

/** Create a NOTAM (admin) */
window.dbCreateNotam = async function(data, user) {
  if (!window.db) {
    showToast('NOTAM created. (Demo — not persisted)', 'success');
    return 'DEMO-N-' + Date.now();
  }
  try {
    const snap = await window.db.collection('notams')
      .orderBy('createdAt', 'desc').limit(1).get();
    const lastId = snap.empty ? '' : (snap.docs[0].data().id || '');
    const nextNum = _nextIdNum(lastId, /(\d{3,})$/);
    const year    = new Date().getFullYear();
    const notamId = `GFIG-N-${year}-${String(nextNum).padStart(3, '0')}`;

    await window.db.collection('notams').doc(notamId).set({
      ...data,
      id:            notamId,
      active:        true,
      createdBy:     user?.uid  || 'admin',
      createdByName: user?.name || 'Admin',
      createdAt:     window.serverTimestamp()
    });

    /* Discord */
    const settings = await window.getSettings();
    if (settings.webhookNotams) {
      const colors = { critical: 15158332, advisory: 15105570, info: 3447003 };
      await window.sendWebhook(settings.webhookNotams, null, [{
        title:       `⚠ NOTAM ${notamId}: ${data.title}`,
        color:       colors[data.severity] || 3447003,
        description: (data.content || '').slice(0, 500),
        fields: [
          { name: 'Severity',  value: (data.severity || 'info').toUpperCase(), inline: true },
          { name: 'Region',    value: data.region    || '—',                   inline: true },
          { name: 'ICAO',      value: data.icao      || 'N/A',                 inline: true },
          { name: 'Effective', value: data.effective || '—',                   inline: true },
          { name: 'Expires',   value: data.expires   || 'Until Cancelled',     inline: true }
        ],
        footer:    { text: 'GFIG NOTAM System' },
        timestamp: new Date().toISOString()
      }]);
    }
    return notamId;
  } catch (e) {
    console.error('dbCreateNotam:', e);
    throw e;
  }
};

/** Expire / deactivate a NOTAM (admin) */
window.dbExpireNotam = async function(notamId) {
  if (!window.db) return;
  await window.db.collection('notams').doc(notamId).update({ active: false });
};

/* ══════════════════════════════════════════════════════════════
   APPLICATIONS
   ══════════════════════════════════════════════════════════════ */

window.dbSubmitApplication = async function(data) {
  if (!window.db) {
    const apps = JSON.parse(localStorage.getItem('gfig_applications') || '[]');
    const id   = 'APP-' + Date.now();
    apps.unshift({ ...data, id, submittedAt: new Date().toISOString(), status: 'pending' });
    localStorage.setItem('gfig_applications', JSON.stringify(apps));
    /* Still fire Discord webhook if configured */
    const settings = await window.getSettings();
    await _webhookApplication(settings, data, id);
    return id;
  }
  const ref = window.db.collection('applications').doc();
  await ref.set({
    ...data,
    status:      'pending',
    submittedAt: window.serverTimestamp()
  });
  const settings = await window.getSettings();
  await _webhookApplication(settings, data, ref.id);
  return ref.id;
};

async function _webhookApplication(settings, data, id) {
  if (!settings.webhookApplications) return;
  await window.sendWebhook(settings.webhookApplications, null, [{
    title: '📋 New Inspector Application',
    color: 3447003,
    fields: [
      { name: 'Name',      value: data.name      || '—', inline: true },
      { name: 'Discord',   value: data.discord   || '—', inline: true },
      { name: 'Region',    value: data.region    || '—', inline: true },
      { name: 'Networks',  value: data.networks  || '—', inline: true },
      { name: 'VATSIM ID', value: data.vatsimId  || 'N/A', inline: true },
      { name: 'Simulator', value: data.simulator || '—', inline: true }
    ],
    description: (data.reason || '').slice(0, 400) || '(no reason provided)',
    footer:    { text: `App ID: ${id} · GFIG Application System` },
    timestamp: new Date().toISOString()
  }]);

  // Send DM confirmation to applicant via Discord bot
  if (settings.botApiUrl && data.discord) {
    try {
      await fetch(settings.botApiUrl.replace(/\/$/, '') + '/dm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': settings.botApiSecret || ''
        },
        body: JSON.stringify({
          discordUsername: data.discord,
          type: 'registration',
          fields: [
            { name: 'Reference', value: id || '—', inline: true },
            { name: 'Name', value: data.name || '—', inline: true },
            { name: 'Status', value: '⏳ Under Review', inline: true }
          ]
        })
      });
    } catch(e) { console.warn('DM notification failed:', e.message); }
  }
}

window.dbGetApplications = async function(status = null) {
  if (!window.db) {
    const apps = JSON.parse(localStorage.getItem('gfig_applications') || '[]');
    return status ? apps.filter(a => a.status === status) : apps;
  }
  try {
    let q = window.db.collection('applications');
    if (status) q = q.where('status', '==', status);
    const snap = await q.orderBy('submittedAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

window.dbUpdateApplicationStatus = async function(appId, status) {
  if (!window.db) return;
  await window.db.collection('applications').doc(appId).update({ status });
};

/* ══════════════════════════════════════════════════════════════
   USERS / MEMBERS
   ══════════════════════════════════════════════════════════════ */

window.dbGetUser = async function(uid) {
  if (!window.db || !uid) return null;
  try {
    const doc = await window.db.collection('users').doc(uid).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch { return null; }
};

window.dbGetMembers = async function() {
  if (!window.db) return null;
  try {
    const snap = await window.db.collection('users').orderBy('points', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return null; }
};

window.dbGetLeaderboard = async function(limit = 10) {
  if (!window.db) return null;
  try {
    const snap = await window.db.collection('users')
      .orderBy('points', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return null; }
};

window.dbUpdateUser = async function(uid, data) {
  if (!window.db || !uid) return;
  await window.db.collection('users').doc(uid).set(data, { merge: true });
};

/** Auto-assign next available member number (never reuses retired numbers) */
window.dbGetNextMemberNumber = async function() {
  if (!window.db) return 'GFIG-0001';
  try {
    const snap = await window.db.collection('users').get();
    let maxNum = 0;
    snap.docs.forEach(d => {
      const mn = d.data().memberNumber || '';
      const m = mn.match(/GFIG-(\d+)/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
    return 'GFIG-' + String(maxNum + 1).padStart(4, '0');
  } catch { return 'GFIG-0001'; }
};

/** Submit a member form (leave, resignation, calibration request) */
window.dbSubmitMemberForm = async function(type, data) {
  if (!window.db) throw new Error('Not connected');
  const ref = await window.db.collection('member_forms').add({
    type,
    ...data,
    status:    'pending',
    createdAt: window.serverTimestamp()
  });
  await dbLogActivity('form', '<strong>' + (data.submittedByName || 'A member') + '</strong> submitted a ' + type + ' request');
  return ref.id;
};

/** Create a new member account in Firestore (called after Firebase Auth signup) */
window.dbCreateMember = async function(uid, profileData) {
  if (!window.db) return;
  await window.db.collection('users').doc(uid).set({
    ...profileData,
    points:        0,
    totalMissions: 0,
    passRate:      100,
    flightHours:   0,
    isAdmin:       false,
    status:        'active',
    joinDate:      window.serverTimestamp()
  });
};

/* ══════════════════════════════════════════════════════════════
   ACTIVITY FEED
   ══════════════════════════════════════════════════════════════ */

async function dbLogActivity(type, text) {
  if (!window.db) return;
  try {
    await window.db.collection('activity').add({
      type,
      text,
      timestamp: window.serverTimestamp()
    });
    /* Prune to last 200 items occasionally */
  } catch {}
}
window.dbLogActivity = dbLogActivity;

window.dbGetActivity = async function(limit = 12) {
  if (!window.db) return null;
  try {
    const snap = await window.db.collection('activity')
      .orderBy('timestamp', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return null; }
};

/* ══════════════════════════════════════════════════════════════
   SETTINGS (admin)
   ══════════════════════════════════════════════════════════════ */

window.dbSaveSettings = async function(data) {
  if (!window.db) {
    /* localStorage fallback */
    const map = {
      webhookApplications: 'gfig_wh_applications',
      webhookCompleted:    'gfig_wh_completed',
      webhookNotams:       'gfig_wh_notams',
      webhookAnnounce:     'gfig_wh_announce',
      ejsPublicKey:        'gfig_ejs_public_key',
      ejsServiceId:        'gfig_ejs_service_id',
      ejsTemplateId:       'gfig_ejs_template_id',
      bannerText:          'gfig_banner_text',
      bannerActive:        'gfig_banner_active'
    };
    Object.entries(data).forEach(([k, v]) => {
      if (map[k]) localStorage.setItem(map[k], String(v));
    });
    window.clearSettingsCache();
    return;
  }
  await window.db.collection('settings').doc('config').set(data, { merge: true });
  window.clearSettingsCache();
};

/* ══════════════════════════════════════════════════════════════
   ANNOUNCEMENTS
   ══════════════════════════════════════════════════════════════ */

window.dbSendAnnouncement = async function(title, body) {
  const settings = await window.getSettings();
  if (!settings.webhookAnnounce) {
    showToast('No announcement webhook configured. Add it in Settings.', 'warn');
    return false;
  }
  await window.sendWebhook(settings.webhookAnnounce, null, [{
    title,
    description: body,
    color:       3447003,
    footer:      { text: 'GFIG Announcement' },
    timestamp:   new Date().toISOString()
  }]);
  return true;
};

/* ══════════════════════════════════════════════════════════════
   TRAINING — Courses, Enrolment & Progress
   ══════════════════════════════════════════════════════════════ */

/** Master course definitions (synced to Firestore on first call) */
const _GFIG_COURSES = [
  { id:'foundation',      title:'GFIG Orientation & SOPs',           category:'Foundation',    icon:'◎', modules:6,  hours:'2',    level:'beginner',     tier:0, prereqs:[], desc:'Introduction to GFIG operations, reporting standards, Discord integration, and inspector responsibilities.' },
  { id:'ils-type-a',      title:'ILS Theory & Type A Calibration',   category:'ILS Systems',   icon:'📡', modules:8,  hours:'4',    level:'intermediate', tier:1, prereqs:['foundation'], desc:'Instrument Landing System fundamentals, glide slope geometry, localizer alignment, and Category I calibration procedures.' },
  { id:'ils-type-b',      title:'ILS Type B — CAT-II/III Procedures',category:'ILS Systems',   icon:'📡', modules:10, hours:'5',    level:'advanced',     tier:2, prereqs:['ils-type-a'], desc:'Advanced ILS calibration for Category II and III precision approaches. Decision height standards and autoland verification.' },
  { id:'vor-dme',         title:'VOR & DME Calibration Techniques',  category:'VOR / DME',     icon:'📻', modules:7,  hours:'3.5',  level:'intermediate', tier:1, prereqs:['foundation'], desc:'VHF omnidirectional range signal check, bearing accuracy, DME range verification, and frequency monitoring procedures.' },
  { id:'approach-val',    title:'Approach Procedure Validation',     category:'Procedures',    icon:'🗺', modules:9,  hours:'4',    level:'intermediate', tier:1, prereqs:['foundation'], desc:'RNAV (GPS/RNP), conventional VOR and NDB approach validation, minimum altitude checks, and obstacle clearance analysis.' },
  { id:'ndb-cal',         title:'NDB Calibration & Coverage Checks', category:'NDB Systems',   icon:'🔊', modules:6,  hours:'3',    level:'intermediate', tier:1, prereqs:['foundation'], desc:'Non-directional beacon theory, bearing accuracy verification, coverage flight patterns, and signal strength analysis.' },
  { id:'sid-star',        title:'SID & STAR Procedure Validation',   category:'SID / STAR',    icon:'✈', modules:8,  hours:'4',    level:'intermediate', tier:1, prereqs:['approach-val'], desc:'Standard instrument departure and arrival procedure validation. Track accuracy, altitude constraints, and chart cross-check methodology.' },
  { id:'airport-survey',  title:'Airport Survey Operations',         category:'Surveys',       icon:'📐', modules:7,  hours:'3.5',  level:'advanced',     tier:2, prereqs:['foundation','vor-dme'], desc:'Full-airport geometry surveys, runway threshold positioning, taxiway verification, and obstacle limitation surface checks.' },
  { id:'atc-coord',       title:'ATC Coordination for Inspectors',   category:'ATC Operations',icon:'📡', modules:5,  hours:'2',    level:'beginner',     tier:0, prereqs:[], desc:'How to coordinate with virtual ATC during inspection flights. Phraseology, special callsigns, and priority handling procedures.' },
  { id:'cat-iii-spec',    title:'CAT-III ILS Specialist Rating',     category:'ILS Specialist', icon:'🔒', modules:12, hours:'6',    level:'expert',       tier:3, prereqs:['ils-type-b'], reqMissions:50, desc:'Advanced autoland-category ILS calibration. Aircraft performance analysis, RVR requirements, and regulatory standards.' },
  { id:'inspector-mgmt',  title:'Inspector Management & Quality',    category:'Chief Track',   icon:'🔒', modules:10, hours:'5',    level:'expert',       tier:3, prereqs:['foundation'], reqMissions:100, reqRank:'Senior Inspector', desc:'Report quality assurance, reviewing junior inspector submissions, mentorship responsibilities, and escalation procedures.' }
];
window._GFIG_COURSES = _GFIG_COURSES;

/** Seed courses to Firestore if not present */
window.dbSeedCourses = async function() {
  if (!window.db) return;
  try {
    const snap = await window.db.collection('courses').limit(1).get();
    if (!snap.empty) return; // already seeded
    const batch = window.db.batch();
    _GFIG_COURSES.forEach(c => {
      batch.set(window.db.collection('courses').doc(c.id), {
        ...c, status:'active', createdAt: window.serverTimestamp()
      });
    });
    await batch.commit();
  } catch(e) { console.warn('dbSeedCourses:', e); }
};

/** Get all courses */
window.dbGetCourses = async function() {
  if (!window.db) return _GFIG_COURSES;
  try {
    const snap = await window.db.collection('courses').get();
    if (snap.empty) { await window.dbSeedCourses(); return _GFIG_COURSES; }
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return _GFIG_COURSES; }
};

/** Create or update a course */
window.dbSaveCourse = async function(courseId, data) {
  if (!window.db) return;
  await window.db.collection('courses').doc(courseId).set(data, { merge: true });
};

/** Enrol a user in a course */
window.dbEnrolCourse = async function(uid, courseId) {
  if (!window.db || !uid) return;
  const docId = uid + '_' + courseId;
  await window.db.collection('training_progress').doc(docId).set({
    uid, courseId, status: 'in-progress', completedModules: [],
    startedAt: window.serverTimestamp(), completedAt: null, completed: false
  }, { merge: true });
};

/** Update course progress — accepts data object with completedModules array */
window.dbUpdateCourseProgress = async function(uid, courseId, data) {
  if (!window.db || !uid) return;
  const docId = uid + '_' + courseId;
  const update = {};
  if (data.completedModules) update.completedModules = data.completedModules;
  if (data.completed) {
    update.status = 'completed';
    update.completed = true;
    update.completedAt = data.completedAt || window.serverTimestamp();
  }
  await window.db.collection('training_progress').doc(docId).set(update, { merge: true });
};

/** Get all progress for a user */
window.dbGetUserProgress = async function(uid) {
  if (!window.db || !uid) return [];
  try {
    const snap = await window.db.collection('training_progress')
      .where('uid', '==', uid).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

/** Get all training progress (admin) */
window.dbGetAllTrainingProgress = async function() {
  if (!window.db) return [];
  try {
    const snap = await window.db.collection('training_progress').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

/** Submit a checkride request to Firestore */
window.dbSubmitCheckride = async function(data) {
  if (!window.db) return 'demo-' + Date.now();
  const ref = await window.db.collection('checkrides').add({
    ...data, status: 'pending', submittedAt: window.serverTimestamp()
  });
  await dbLogActivity('training', '<strong>' + (data.name || 'A trainee') + '</strong> requested a checkride for ' + (data.type || ''));
  return ref.id;
};

/** Get all checkride requests (admin) */
window.dbGetCheckrides = async function() {
  if (!window.db) return [];
  try {
    const snap = await window.db.collection('checkrides').orderBy('submittedAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

/** Update checkride status (admin) */
window.dbUpdateCheckride = async function(id, status) {
  if (!window.db) return;
  await window.db.collection('checkrides').doc(id).update({ status, reviewedAt: window.serverTimestamp() });
};

/* ══════════════════════════════════════════════════════════════
   EVENTS
   ══════════════════════════════════════════════════════════════ */

/** Create an event */
window.dbCreateEvent = async function(data) {
  if (!window.db) return 'demo-evt-' + Date.now();
  const ref = await window.db.collection('events').add({
    ...data, rsvps: [], rsvpCount: 0, status: 'upcoming',
    createdAt: window.serverTimestamp()
  });
  await dbLogActivity('event', 'New event created: <strong>' + (data.title || '') + '</strong>');
  return ref.id;
};

/** Get events */
window.dbGetEvents = async function(status) {
  if (!window.db) return [];
  try {
    let q = window.db.collection('events');
    if (status) q = q.where('status', '==', status);
    const snap = await q.orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

/** RSVP to an event */
window.dbRSVPEvent = async function(eventId, uid, name) {
  if (!window.db || !uid) return;
  const ref = window.db.collection('events').doc(eventId);
  await ref.update({
    rsvps: window.arrayUnion({ uid, name, at: new Date().toISOString() }),
    rsvpCount: window.increment(1)
  });
};

/** Update event (admin) */
window.dbUpdateEvent = async function(eventId, data) {
  if (!window.db) return;
  await window.db.collection('events').doc(eventId).set(data, { merge: true });
};

/** Delete event (admin) */
window.dbDeleteEvent = async function(eventId) {
  if (!window.db) return;
  await window.db.collection('events').doc(eventId).delete();
};

/* ══════════════════════════════════════════════════════════════
   AWARDS
   ══════════════════════════════════════════════════════════════ */

/** Check milestones and unlock awards for a user. Called after report submission. */
window.dbCheckAndUnlockAwards = async function(uid) {
  if (!window.db || !uid) return [];
  try {
    const [userSnap, reportsSnap] = await Promise.all([
      window.db.collection('users').doc(uid).get(),
      window.db.collection('reports').where('submittedBy', '==', uid).get()
    ]);
    if (!userSnap.exists) return [];
    const userData = userSnap.data();
    const total = userData.totalMissions || 0;
    const reports = reportsSnap.docs.map(d => d.data());
    const regions = new Set(reports.map(r => r.region).filter(Boolean));
    const existing = (userData.awards || []).map(a => typeof a === 'string' ? a : a.id);
    const newAwards = [...(userData.awards || [])];
    let changed = false;

    function maybeUnlock(id, name, icon) {
      if (existing.includes(id)) return;
      const today = new Date().toISOString().split('T')[0];
      newAwards.push({ id, name, icon, earnedDate: today });
      changed = true;
    }

    if (total >= 1)   maybeUnlock('first-mission', 'First Mission Complete', '🥇');
    if (total >= 25)  maybeUnlock('missions-25',   '25 Missions',            '🪙');
    if (total >= 100) maybeUnlock('centurion',      'Centurion',              '🏅');
    if (regions.size >= 5) maybeUnlock('globetrotter', 'Globetrotter',       '🌍');

    if (changed) {
      await window.db.collection('users').doc(uid).set({ awards: newAwards }, { merge: true });
    }
    return newAwards;
  } catch(e) {
    console.warn('dbCheckAndUnlockAwards:', e.message);
    return [];
  }
};

/* ══════════════════════════════════════════════════════════════
   PILOT LOGBOOK
   ══════════════════════════════════════════════════════════════ */

/** Add a logbook entry */
window.dbAddLogEntry = async function(uid, data) {
  if (!window.db || !uid) return null;
  const ref = await window.db.collection('logbook').add({
    ...data, pilotUid: uid, createdAt: window.serverTimestamp()
  });
  return ref.id;
};

/** Get logbook entries for a pilot */
window.dbGetLogEntries = async function(uid) {
  if (!window.db || !uid) return [];
  try {
    const snap = await window.db.collection('logbook')
      .where('pilotUid', '==', uid).orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

/** Delete a logbook entry */
window.dbDeleteLogEntry = async function(entryId) {
  if (!window.db) return;
  await window.db.collection('logbook').doc(entryId).delete();
};

/* ══════════════════════════════════════════════════════════════
   PIREP SYSTEM
   ══════════════════════════════════════════════════════════════ */

/** Submit a PIREP */
window.dbSubmitPirep = async function(uid, data) {
  if (!window.db || !uid) return null;
  const ref = await window.db.collection('pireps').add({
    ...data, pilotUid: uid, status: 'active',
    createdAt: window.serverTimestamp()
  });
  return ref.id;
};

/** Get recent PIREPs (all pilots) */
window.dbGetPireps = async function(limit) {
  if (!window.db) return [];
  try {
    const snap = await window.db.collection('pireps')
      .orderBy('createdAt', 'desc').limit(limit || 50).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

/* ══════════════════════════════════════════════════════════════
   FLEET / AIRCRAFT REGISTRY
   ══════════════════════════════════════════════════════════════ */

/** Add aircraft to fleet */
window.dbAddAircraft = async function(data) {
  if (!window.db) return null;
  const ref = await window.db.collection('fleet').add({
    ...data, createdAt: window.serverTimestamp()
  });
  return ref.id;
};

/** Get fleet */
window.dbGetFleet = async function() {
  if (!window.db) return [];
  try {
    const snap = await window.db.collection('fleet').orderBy('type').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

/** Update aircraft */
window.dbUpdateAircraft = async function(id, data) {
  if (!window.db) return;
  await window.db.collection('fleet').doc(id).set(data, { merge: true });
};

/** Delete aircraft */
window.dbDeleteAircraft = async function(id) {
  if (!window.db) return;
  await window.db.collection('fleet').doc(id).delete();
};

/* ══════════════════════════════════════════════════════════════
   DOCUMENTS LIBRARY
   ══════════════════════════════════════════════════════════════ */

/** Add a document */
window.dbAddDocument = async function(data, user) {
  if (!window.db) return null;
  const ref = await window.db.collection('documents').add({
    ...data, uploadedBy: user ? user.uid : null,
    uploaderName: user ? user.name : 'System',
    createdAt: window.serverTimestamp(), version: data.version || 1
  });
  return ref.id;
};

/** Get all documents */
window.dbGetDocuments = async function() {
  if (!window.db) return [];
  try {
    const snap = await window.db.collection('documents')
      .orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
};

/** Delete a document */
window.dbDeleteDocument = async function(id) {
  if (!window.db) return;
  await window.db.collection('documents').doc(id).delete();
};

/* ══════════════════════════════════════════════════════════════
   NOTIFICATIONS
   ══════════════════════════════════════════════════════════════ */

/** Send a notification to a specific user (stored in Firestore). */
window.dbSendNotification = async function(targetUid, data) {
  if (!window.db || !targetUid) return;
  return window.db.collection('notifications').add({
    targetUid, type: data.type || 'info',
    title: data.title || '', message: data.message || '',
    link: data.link || '', read: false,
    createdAt: window.serverTimestamp()
  });
};

/** Send a notification to all users. */
window.dbBroadcastNotification = async function(data) {
  if (!window.db) return;
  return window.db.collection('notifications').add({
    targetUid: '__all__', type: data.type || 'info',
    title: data.title || '', message: data.message || '',
    link: data.link || '', read: false,
    createdAt: window.serverTimestamp()
  });
};

/** Get notifications for a user (includes broadcasts). */
window.dbGetNotifications = async function(uid, limit) {
  if (!window.db || !uid) return [];
  limit = limit || 30;
  try {
    const [personal, broadcasts] = await Promise.all([
      window.db.collection('notifications').where('targetUid', '==', uid)
        .orderBy('createdAt', 'desc').limit(limit).get(),
      window.db.collection('notifications').where('targetUid', '==', '__all__')
        .orderBy('createdAt', 'desc').limit(limit).get()
    ]);
    var all = [];
    personal.docs.forEach(function(d) { all.push({ id: d.id, ...d.data() }); });
    broadcasts.docs.forEach(function(d) { all.push({ id: d.id, ...d.data() }); });
    all.sort(function(a,b) {
      var at = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : new Date(0);
      var bt = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : new Date(0);
      return bt - at;
    });
    return all.slice(0, limit);
  } catch { return []; }
};

/** Mark a notification as read. */
window.dbMarkNotificationRead = async function(notifId) {
  if (!window.db || !notifId) return;
  await window.db.collection('notifications').doc(notifId).update({ read: true });
};

/** Mark all notifications as read for a user. */
window.dbMarkAllRead = async function(uid) {
  if (!window.db || !uid) return;
  const snap = await window.db.collection('notifications')
    .where('targetUid', '==', uid).where('read', '==', false).get();
  const batch = window.db.batch();
  snap.docs.forEach(function(d) { batch.update(d.ref, { read: true }); });
  await batch.commit();
};
