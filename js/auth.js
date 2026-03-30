/* ================================================================
   GFIG — Authentication System (auth.js)
   localStorage-based session management for member/admin gating.
   ================================================================ */

const gfigAuth = {
  SESSION_KEY: 'gfig_session',

  /* Demo accounts — replace with real backend integration later */
  DEMO_USER: {
    name: 'CPT Harrison',
    callsign: 'GFIG-INS-0042',
    rank: 'Senior Inspector',
    rank_class: 'rank-senior',
    points: 4820,
    isAdmin: false,
    avatar: 'JH',
    division: 'UK'
  },

  DEMO_ADMIN: {
    name: 'DIR Williams',
    callsign: 'GFIG-DIR-0001',
    rank: 'Director',
    rank_class: 'rank-director',
    points: 15200,
    isAdmin: true,
    avatar: 'DW',
    division: 'US'
  },

  /** Store a user session */
  login(userData) {
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(userData));
  },

  /** Clear session and return home */
  logout() {
    localStorage.removeItem(this.SESSION_KEY);
    window.location.href = 'index.html';
  },

  /** Return the current session object, or null */
  getUser() {
    try {
      const d = localStorage.getItem(this.SESSION_KEY);
      return d ? JSON.parse(d) : null;
    } catch { return null; }
  },

  isLoggedIn() { return !!this.getUser(); },

  isAdmin() {
    const u = this.getUser();
    return !!(u && u.isAdmin === true);
  },

  /**
   * Redirect to login.html if not signed in.
   * Preserves the current page as ?redirect= query param.
   */
  guard() {
    if (!this.isLoggedIn()) {
      const page = (window.location.pathname.split('/').pop() || '');
      window.location.href = 'login.html' + (page ? '?redirect=' + encodeURIComponent(page) : '');
      return false;
    }
    this.applyNav();
    return true;
  },

  /**
   * Redirect non-admins.
   * Sends guests to login.html; signed-in non-admins to dashboard.html.
   */
  adminGuard() {
    if (!this.isLoggedIn()) {
      window.location.href = 'login.html';
      return false;
    }
    if (!this.isAdmin()) {
      window.location.href = 'dashboard.html';
      return false;
    }
    this.applyNav();
    return true;
  },

  /** Update nav elements from session data */
  applyNav() {
    const user = this.getUser();
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
