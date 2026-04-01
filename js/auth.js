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
    name:          'Demo Inspector',
    callsign:      'GFIG-0000',
    rank:          'Inspector',
    rank_class:    'rank-inspector',
    points:        0,
    isAdmin:       false,
    avatar:        'DI',
    division:      '',
    _isDemo:       true,
    totalMissions: 0,
    passRate:      null,
    flightHours:   0
  },

  DEMO_ADMIN: {
    uid:           'demo-admin',
    name:          'Demo Admin',
    callsign:      'GFIG-ADM-0000',
    rank:          'Director',
    rank_class:    'rank-director',
    points:        0,
    isAdmin:       true,
    avatar:        'DA',
    division:      '',
    _isDemo:       true,
    totalMissions: 0,
    passRate:      null,
    flightHours:   0
  },

  /* ── Session helpers ─────────────────────────────────────── */
  _save(data)  { localStorage.setItem(this.SESSION_KEY, JSON.stringify(data)); },
  _load()      { try { return JSON.parse(localStorage.getItem(this.SESSION_KEY)); } catch { return null; } },
  _clear()     { localStorage.removeItem(this.SESSION_KEY); },

  getUser()    { return this._currentUser; },
  isLoggedIn() { return !!this._currentUser; },
  isAdmin()    { return !!(this._currentUser && this._currentUser.isAdmin); },

  /* Role-based access checks */
  hasRole(role) {
    var u = this._currentUser;
    if (!u) return false;
    if (u.isAdmin) return true; // Admins/Directors see everything
    var r = (u.rank || '').toLowerCase();
    if (r.indexOf('director') > -1 || r.indexOf('chief') > -1) return true;
    switch(role) {
      case 'training':  return !!u.isInstructor || !!u.isExaminer || r.indexOf('training') > -1;
      case 'events':    return !!u.isEventsTeam || r.indexOf('training') > -1;
      case 'hr':        return !!u.isHR || r === 'hr officer';
      case 'notams':    return !!u.isNotamManager;
      case 'examiner':  return !!u.isExaminer;
      case 'instructor':return !!u.isInstructor;
      default: return false;
    }
  },

  hasAnyStaffRole() {
    return this.isAdmin() || this.hasRole('training') || this.hasRole('events') || this.hasRole('hr') || this.hasRole('notams');
  },

  /* ── Real email/password sign-in (Firebase) ─────────────── */
  async loginWithEmail(email, password) {
    if (!window.auth) throw new Error('Firebase is not configured.');
    return window.auth.signInWithEmailAndPassword(email, password);
  },

  /* ── Account registration (Firebase) ────────────────────── */
  async registerWithEmail(email, password, displayName) {
    if (!window.auth) throw new Error('Firebase is not configured.');
    const cred = await window.auth.createUserWithEmailAndPassword(email, password);
    if (displayName) await cred.user.updateProfile({ displayName });
    return cred;
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
          const docRef = window.db.collection('users').doc(firebaseUser.uid);
          const doc    = await docRef.get();
          const isBootstrapAdmin = (window.GFIG_ADMIN_EMAILS || []).includes(firebaseUser.email);

          if (doc.exists) {
            profile = { uid: firebaseUser.uid, ...doc.data(), isAdmin: doc.data().isAdmin || isBootstrapAdmin };
          } else {
            /* First login — create profile document */
            const initials = (firebaseUser.displayName || firebaseUser.email || 'IN')
              .split(/[\s@]+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
            /* Auto-assign a unique member number (never reused) */
            const memberNumber = window.dbGetNextMemberNumber
              ? await window.dbGetNextMemberNumber().catch(() => null)
              : null;
            const newProfile = {
              name:          firebaseUser.displayName || firebaseUser.email,
              email:         firebaseUser.email,
              avatar:        initials,
              isAdmin:       isBootstrapAdmin,
              memberNumber:  memberNumber || null,
              callsign:      memberNumber || null,
              rank:          'Trainee Inspector',
              points:        0,
              totalMissions: 0,
              passRate:      null,
              flightHours:   0,
              joinDate:      window.serverTimestamp ? window.serverTimestamp() : new Date().toISOString(),
              joinedDisplay: new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }),
              status:        'active'
            };
            await docRef.set(newProfile).catch(() => {});
            profile = { uid: firebaseUser.uid, ...newProfile };
          }
        } catch {
          const isBootstrapAdmin = (window.GFIG_ADMIN_EMAILS || []).includes(firebaseUser.email);
          profile = { uid: firebaseUser.uid, name: firebaseUser.email, avatar: 'IN', isAdmin: isBootstrapAdmin, email: firebaseUser.email };
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

  /* Staff guard: allows admin OR any staff role holder */
  staffGuard() {
    const self = this;
    this.guard(false);
    document.addEventListener('gfig:authready', function() {
      if (!self.hasAnyStaffRole()) {
        window.location.href = 'dashboard.html';
      }
    });
  },

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

    if (user.isAdmin || this.hasAnyStaffRole()) {
      document.querySelectorAll('.nav-admin-link').forEach(el => {
        el.style.removeProperty('display');
      });
    }
  }
};
