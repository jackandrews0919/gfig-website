/* ================================================================
   GFIG — Firebase Configuration & Initialization (firebase.js)

   SETUP INSTRUCTIONS:
   1. Go to https://console.firebase.google.com/
   2. Click "Add project" (or open your existing GFIG project)
   3. Add a Web App → copy your firebaseConfig object
   4. Paste your real values into FIREBASE_CONFIG below
   5. In Firebase Console → Authentication → Sign-in method:
        Enable "Email/Password"
   6. In Firebase Console → Firestore Database:
        Create database → start in test mode
        Then apply the rules from firestore.rules
   7. Save this file and refresh the site

   Demo mode (no Firebase):
   The site remains fully functional with demo logins until you
   configure Firebase. Once configured, real accounts and persistent
   data replace the demo session.
   ================================================================ */

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

/* ── Bootstrap admin accounts ─────────────────────────────────
   Emails listed here are always treated as admins, even before
   a Firestore user document exists. Add/remove as needed.
   ─────────────────────────────────────────────────────────── */
window.GFIG_ADMIN_EMAILS = [
  'jackandrews0919@gmail.com'
];

/* ── Initialize (only when config is filled in) ── */
window.GFIG_FIREBASE_READY = false;
window.db   = null;
window.auth = null;

if (FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY') {
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    window.db   = firebase.firestore();
    window.auth = firebase.auth();
    window.GFIG_FIREBASE_READY = true;
    console.info('GFIG: Firebase initialized ✓');
  } catch (e) {
    console.warn('GFIG: Firebase init failed —', e.message);
  }
} else {
  console.info('GFIG: Firebase not configured — running in demo/localStorage mode.');
}

/* ── Timestamp helper (works in both modes) ── */
window.serverTimestamp = window.GFIG_FIREBASE_READY
  ? () => firebase.firestore.FieldValue.serverTimestamp()
  : () => new Date().toISOString();

window.increment = window.GFIG_FIREBASE_READY
  ? (n) => firebase.firestore.FieldValue.increment(n)
  : (n) => n; // fallback — won't actually increment server-side in demo

/* ── Discord Webhook helper ── */
window.sendWebhook = async function(url, content = null, embeds = []) {
  if (!url || !url.startsWith('https://discord.com/api/webhooks/')) return;
  try {
    const body = {};
    if (content) body.content = content;
    if (embeds.length) body.embeds = embeds;
    await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
  } catch (e) {
    console.warn('GFIG: Webhook failed —', e.message);
  }
};

/* ── Settings cache & loader ── */
let _cachedSettings = null;
window.getSettings = async function() {
  if (_cachedSettings) return _cachedSettings;

  if (!window.db) {
    /* Fall back to localStorage keys saved by admin.html */
    _cachedSettings = {
      webhookApplications: localStorage.getItem('gfig_wh_applications') || '',
      webhookCompleted:    localStorage.getItem('gfig_wh_completed')    || '',
      webhookNotams:       localStorage.getItem('gfig_wh_notams')       || '',
      webhookAnnounce:     localStorage.getItem('gfig_wh_announce')     || '',
      ejsPublicKey:        localStorage.getItem('gfig_ejs_public_key')  || '',
      ejsServiceId:        localStorage.getItem('gfig_ejs_service_id')  || '',
      ejsTemplateId:       localStorage.getItem('gfig_ejs_template_id') || '',
      bannerText:          localStorage.getItem('gfig_banner_text')     || '',
      bannerActive:        localStorage.getItem('gfig_banner_active') === 'true'
    };
    return _cachedSettings;
  }

  try {
    const doc = await window.db.collection('settings').doc('config').get();
    _cachedSettings = doc.exists ? doc.data() : {};
  } catch {
    _cachedSettings = {};
  }
  return _cachedSettings;
};

/* ── Invalidate settings cache (call after saving settings) ── */
window.clearSettingsCache = function() { _cachedSettings = null; };
