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
