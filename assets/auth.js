// assets/auth.js
// Shared Supabase client + auth helpers for the Cresce Forte hub (/login/, /app/, /admin/).
// Include the @supabase/supabase-js UMD <script> tag BEFORE this file on every page that uses it.
//
// Usage:
//   const session = await CresceForteAuth.requireRole('PLATFORM'); // redirects to /login/ if not signed in,
//                                                                   // or to /app/ if signed in with the wrong role
//   await CresceForteAuth.logout();
//
// requireAuth() below also exists, but only checks localStorage (see its own
// comment) — prefer requireRole() or validatedSession() for any real access check.

(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://snxcmrnubtcryxnkzpzc.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNueGNtcm51YnRjcnl4bmt6cHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMDc4NjksImV4cCI6MjEwNDc4Mzg2OX0.RAJusXsGb_Wdy-CytS8qtNLbIthyFUG3qri0Fj3-hcw';

  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    throw new Error('assets/auth.js: the @supabase/supabase-js UMD <script> tag must be included before this file.');
  }

  // Cliente PRINCIPAL (guarda sessão em localStorage). detectSessionInUrl
  // (padrão: true) faria o supabase-js gravar como sessão o que vier em
  // #access_token=...&refresh_token=... em QUALQUER página: um link com os
  // tokens da conta do atacante sobrescreveria a sessão real da vítima
  // (login CSRF, achado 6 da Esther). Aqui fica false, sempre, em toda rota.
  //
  // Booleano e não função (url, params) => boolean: o supabase-js fixado nas
  // páginas (2.45.4) só testa `if (detectSessionInUrl)`, e uma função é sempre
  // truthy — deixaria a detecção LIGADA. O booleano vale em qualquer versão.
  //
  // Este arquivo é compartilhado por /login/, /app/, /admin/ e /reset-password/:
  // NUNCA criar aqui um segundo client com detecção ligada (ele rodaria em toda
  // página). O client de recuperação de senha é criado só em reset-password.js.
  var client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { detectSessionInUrl: false }
  });

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
  //
  // Only checks localStorage (getSession), never the server — a forged
  // session blob passes. No page calls this today; prefer requireRole() or
  // validatedSession() for anything that gates real access.
  async function requireAuth(loginUrl) {
    loginUrl = loginUrl || '/login/';
    var session = await getSession();
    if (!session) {
      global.location.href = loginUrl;
      return null;
    }
    return session;
  }

  // Ensures there is a valid session AND that the user's app_metadata.user_type matches
  // `userType`. Otherwise redirects to `options.fallbackUrl` (defaults to /app/) if signed
  // in with the wrong role, or to `options.loginUrl` (defaults to /login/) if not signed in.
  //
  // Unlike requireAuth(), this one validates the token against the server
  // (validatedSession) before looking at the role — a role check is only worth
  // as much as the session it reads, and the stored session is forgeable.
  async function requireRole(userType, options) {
    options = options || {};
    var loginUrl = options.loginUrl || '/login/';
    var fallbackUrl = options.fallbackUrl || '/app/';

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
    loginUrl = loginUrl || '/login/';
    try {
      await client.auth.signOut();
    } catch (err) {
      console.error('CresceForteAuth.logout error:', err);
    }
    global.location.href = loginUrl;
  }

  // Sends the user to the right home screen for their role.
  function routeForUserType(userType) {
    global.location.href = userType === 'PLATFORM' ? '/admin/' : '/app/';
  }

  // Shared eye icon (same SVG element, swap only the inner path/circle) used by
  // /login/, /reset-password/ and /admin/ — one copy instead of one per page.
  var EYE_OPEN = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>';
  var EYE_OFF = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a20.3 20.3 0 0 1-3.22 4.34M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

  // Wires an eye-icon <button> that toggles some hidden value's visibility.
  // `onToggle(showing)` applies the actual show/hide (e.g. input.type, or
  // swapping displayed text) — this only owns the icon and aria state.
  function wireEyeToggle(button, onToggle, labels) {
    labels = labels || {};
    var showLabel = labels.show || 'Mostrar senha';
    var hideLabel = labels.hide || 'Esconder senha';
    button.addEventListener('click', function () {
      var showing = button.getAttribute('aria-pressed') === 'true';
      var next = !showing;
      button.setAttribute('aria-pressed', String(next));
      button.setAttribute('aria-label', next ? hideLabel : showLabel);
      button.querySelector('svg').innerHTML = next ? EYE_OFF : EYE_OPEN;
      onToggle(next);
    });
  }

  // Wires an eye-icon button next to a password <input>, toggling its type.
  function wirePasswordToggle(input, button) {
    wireEyeToggle(button, function (showing) {
      input.type = showing ? 'text' : 'password';
    });
  }

  global.CresceForteAuth = {
    client: client,
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    getSession: getSession,
    validatedSession: validatedSession,
    getUserType: getUserType,
    getCompanyId: getCompanyId,
    requireAuth: requireAuth,
    requireRole: requireRole,
    logout: logout,
    routeForUserType: routeForUserType,
    EYE_OPEN: EYE_OPEN,
    EYE_OFF: EYE_OFF,
    wireEyeToggle: wireEyeToggle,
    wirePasswordToggle: wirePasswordToggle
  };
})(window);
