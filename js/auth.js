/* ================================================================
   GFIG — Authentication System (auth.js)
   Supports Firebase Auth (when configured via firebase.js) and
   localStorage demo mode (when Firebase is not yet set up).

   Guard behaviour:
   • Firebase mode  — async; hides page until auth state resolves.
   • Demo mode      — sync; reads localStorage session immediately.
   Both modes dispatch the 'gfig:authready' custom event once the
   user object is available, so page scripts can safely read data.
   ================================================================ */

const gfigAuth = {
  SESSION_KEY: 'gfig_session',
  _currentUser: null,

  /* ── Demo account data ─────────────────────────────────────── */
  DEMO_USER: {
    uid:           'demo-inspector',
    name:          'CPT Harrison',
    callsign:      'GFIG-INS-0042',
    rank:          'Senior Inspector',
    rank_class:    'rank-senior',
    points:        4820,
    isAdmin:       false,
    avatar:        'JH',
    division:      'UK',
    _isDemo:       true,
    totalMissions: 142,
    passRate:      96,
    flightHours:   1246
  },

  DEMO_ADMIN: {
    uid:           'demo-admin',
    name:          'DIR Williams',
    callsign:      'GFIG-DIR-0001',
    rank:          'Director',
    rank_class:    'rank-director',
    points:        15200,
    isAdmin:       true,
    avatar:        'DW',
    division:      'US',
    _isDemo:       true,
    totalMissions: 312,
    passRate:      98,
    flightHours:   4820
  },

  /* ── Session helpers ─────────────────────────────────────── */
  _save(data)  { localStorage.setItem(this.SESSION_KEY, JSON.stringify(data)); },
  _load()      { try { return JSON.parse(localStorage.getItem(this.SESSION_KEY)); } catch { return null; } },
  _clear()     { localStorage.removeItem(this.SESSION_KEY); },

  getUser()    { return this._currentUser; },
  isLoggedIn() { return !!this._currentUser; },
  isAdmin()    { return !!(this._currentUser && this._currentUser.isAdmin); },

  /* ── Real email/password sign-in (Firebase) ─────────────── */
  async loginWithEmail(email, password) {
    if (!window.auth) throw new Error('Firebase is not configured.');
    return window.auth.signInWithEmailAndPassword(email, password);
  },

  /* ── Demo logins (keep for testing without Firebase) ─────── */
  demoLogin() {
    this._save(this.DEMO_USER);
    const params = new URLSearchParams(location.search);
    const dest   = params.get('redirect');
    window.location.href = (dest && /^[\w-]+\.html$/.test(dest)) ? dest : 'dashboard.html';
  },

  adminDemoLogin() {
    this._save(this.DEMO_ADMIN);
    window.location.href = 'admin.html';
  },

  /* ── Logout (works in both modes) ───────────────────────── */
  logout() {
    this._clear();
    this._currentUser = null;
    if (window.auth && window.GFIG_FIREBASE_READY) {
      window.auth.signOut().catch(() => {});
    }
    window.location.href = 'index.html';
  },

  /* ── Guard: redirect if not authenticated ────────────────── */
  guard(adminRequired = false) {
    const useFirebase = !!(window.GFIG_FIREBASE_READY && window.auth);

    if (useFirebase) {
      /* Hide body until Firebase auth state resolves */
      document.documentElement.style.visibility = 'hidden';

      window.auth.onAuthStateChanged(async firebaseUser => {
        if (!firebaseUser) {
          /* Check for a localStorage demo session as a fallback */
          const demo = this._load();
          if (demo && demo._isDemo) {
            this._currentUser = demo;
            if (adminRequired && !this.isAdmin()) {
              window.location.href = 'dashboard.html';
              return;
            }
            this.applyNav();
            document.documentElement.style.visibility = '';
            document.dispatchEvent(new CustomEvent('gfig:authready', { detail: this._currentUser }));
            return;
          }
          const page = window.location.pathname.split('/').pop() || '';
          window.location.href = 'login.html' + (page ? '?redirect=' + encodeURIComponent(page) : '');
          return;
        }

        /* Fetch Firestore profile */
        let profile = null;
        try {
          const doc = await window.db.collection('users').doc(firebaseUser.uid).get();
          profile = doc.exists
            ? { uid: firebaseUser.uid, ...doc.data() }
            : { uid: firebaseUser.uid, name: firebaseUser.email, avatar: 'IN', isAdmin: false, email: firebaseUser.email };
        } catch {
          profile = { uid: firebaseUser.uid, name: firebaseUser.email, avatar: 'IN', isAdmin: false };
        }

        this._currentUser = profile;

        if (adminRequired && !this.isAdmin()) {
          window.location.href = 'dashboard.html';
          return;
        }
        this.applyNav();
        document.documentElement.style.visibility = '';
        document.dispatchEvent(new CustomEvent('gfig:authready', { detail: this._currentUser }));
      });

    } else {
      /* Demo / localStorage mode — synchronous */
      const session = this._load();
      if (!session) {
        const page = window.location.pathname.split('/').pop() || '';
        window.location.href = 'login.html' + (page ? '?redirect=' + encodeURIComponent(page) : '');
        return;
      }
      this._currentUser = session;
      if (adminRequired && !this.isAdmin()) {
        window.location.href = 'dashboard.html';
        return;
      }
      this.applyNav();
      /* Fire event after current call stack so page scripts can set listeners */
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('gfig:authready', { detail: this._currentUser }));
      }, 0);
    }
  },

  adminGuard() { this.guard(true); },

  /* ── Apply nav elements from current user ────────────────── */
  applyNav() {
    const user = this._currentUser;
    if (!user) return;

    document.querySelectorAll('.nav-pilot-name, #nav-name').forEach(el => {
      el.textContent = user.name || 'Inspector';
    });
    document.querySelectorAll('.nav-pilot-rank').forEach(el => {
      el.textContent = user.rank || '';
    });
    document.querySelectorAll('.nav-avatar, #nav-avatar').forEach(el => {
      el.textContent = user.avatar ||
        (user.name || 'IN').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    });

    if (user.isAdmin) {
      document.querySelectorAll('.nav-admin-link').forEach(el => {
        el.style.removeProperty('display');
      });
    }
  }
};
