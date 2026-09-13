// assets/auth.js
// Shared Supabase client + auth helpers for the Cresce Forte hub (login.html, app.html, admin.html).
// Include the @supabase/supabase-js UMD <script> tag BEFORE this file on every page that uses it.
//
// Usage:
//   const session = await CresceForteAuth.requireAuth();          // redirects to login.html if not signed in
//   const session = await CresceForteAuth.requireRole('PLATFORM'); // also redirects non-PLATFORM users to app.html
//   await CresceForteAuth.logout();

(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://snxcmrnubtcryxnkzpzc.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNueGNtcm51YnRjcnl4bmt6cHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMDc4NjksImV4cCI6MjEwNDc4Mzg2OX0.RAJusXsGb_Wdy-CytS8qtNLbIthyFUG3qri0Fj3-hcw';

  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    throw new Error('assets/auth.js: the @supabase/supabase-js UMD <script> tag must be included before this file.');
  }

  var client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Returns the current Supabase session, or null if there isn't one (or on error).
  //
  // getSession() reads whatever is persisted in localStorage and only talks to
  // the server when the token has expired. That is fine for "is someone signed
  // in here?", so requireAuth() uses it — but it is NOT enough to decide what
  // that someone is allowed to see. See validatedSession() below.
  async function getSession() {
    var result = await client.auth.getSession();
    if (result.error) {
      console.error('CresceForteAuth.getSession error:', result.error);
      return null;
    }
    return result.data && result.data.session ? result.data.session : null;
  }

  // Same as getSession(), but confirms the token with the Supabase server
  // before returning it.
  //
  // Why this exists: the session object lives in localStorage, and localStorage
  // is writable from the browser console. With getSession() alone, anyone could
  // hand-craft a session blob containing app_metadata.user_type = 'PLATFORM'
  // and make admin.html render the Super Admin shell. No real data would come
  // back (the anon key has no grants on companies/services/company_services,
  // and PostgREST would reject the forged token), but the screen itself is a
  // useful thing to hand an attacker — it maps the platform's structure and
  // makes an internal phishing page trivial to build.
  //
  // getUser() asks the server, so a fabricated token simply fails here.
  async function validatedSession() {
    var session = await getSession();
    if (!session) return null;

    var result = await client.auth.getUser();
    if (result.error || !result.data || !result.data.user) {
      console.error('CresceForteAuth.validatedSession: token rejected by the server.', result.error);
      return null;
    }

    // Use the server's copy of the user, not the one that came from storage —
    // app_metadata (user_type, company_id) is what the role checks read.
    session.user = result.data.user;
    return session;
  }

  // Reads the signed-in user's user_type from app_metadata (set by Supabase Auth admin / backend).
  function getUserType(session) {
    return session && session.user && session.user.app_metadata
      ? session.user.app_metadata.user_type
      : undefined;
  }

  // Reads the signed-in user's company_id from app_metadata. Undefined for PLATFORM users.
  function getCompanyId(session) {
    return session && session.user && session.user.app_metadata
      ? session.user.app_metadata.company_id
      : undefined;
  }

  // Ensures there is a valid session; otherwise redirects to the login page.
  // Returns the session (never null) when it resolves without redirecting.
  async function requireAuth(loginUrl) {
    loginUrl = loginUrl || 'login.html';
    var session = await getSession();
    if (!session) {
      global.location.href = loginUrl;
      return null;
    }
    return session;
  }

  // Ensures there is a valid session AND that the user's app_metadata.user_type matches
  // `userType`. Otherwise redirects to `options.fallbackUrl` (defaults to app.html) if signed
  // in with the wrong role, or to `options.loginUrl` (defaults to login.html) if not signed in.
  //
  // Unlike requireAuth(), this one validates the token against the server
  // (validatedSession) before looking at the role — a role check is only worth
  // as much as the session it reads, and the stored session is forgeable.
  async function requireRole(userType, options) {
    options = options || {};
    var loginUrl = options.loginUrl || 'login.html';
    var fallbackUrl = options.fallbackUrl || 'app.html';

    var session = await validatedSession();
    if (!session) {
      global.location.href = loginUrl;
      return null;
    }

    if (getUserType(session) !== userType) {
      global.location.href = fallbackUrl;
      return null;
    }
    return session;
  }

  // Signs the user out and redirects to the login page.
  async function logout(loginUrl) {
    loginUrl = loginUrl || 'login.html';
    try {
      await client.auth.signOut();
    } catch (err) {
      console.error('CresceForteAuth.logout error:', err);
    }
    global.location.href = loginUrl;
  }

  global.CresceForteAuth = {
    client: client,
    getSession: getSession,
    validatedSession: validatedSession,
    getUserType: getUserType,
    getCompanyId: getCompanyId,
    requireAuth: requireAuth,
    requireRole: requireRole,
    logout: logout
  };
})(window);
