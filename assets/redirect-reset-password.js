// assets/redirect-reset-password.js
// The old /reset-password.html URL needs a script (not just meta refresh)
// because the recovery link's #access_token=... hash must survive the
// redirect — a static meta-refresh target can't carry it forward.
location.href = '/reset-password/' + location.hash;
