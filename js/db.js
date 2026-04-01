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

/** Create a new mission (admin) */
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

    await window.db.collection('missions').doc(missionId).set({
      ...data,
      id:            missionId,
      status:        'available',
      claimedBy:     null,
      claimedByName: null,
      claimedAt:     null,
      createdAt:     window.serverTimestamp()
    });
    await dbLogActivity('active', `Admin created mission <strong>${missionId}</strong>`);
    return missionId;
  } catch (e) {
    console.error('dbCreateMission:', e);
    throw e;
  }
};

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
