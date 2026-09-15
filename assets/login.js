// assets/login.js — page logic for /login/. Requires supabase-js + auth.js loaded first.
(function () {
  var form = document.getElementById('login-form');
  var emailInput = document.getElementById('email');
  var passwordInput = document.getElementById('password');
  var submitBtn = document.getElementById('submit-btn');
  var forgotBtn = document.getElementById('forgot-btn');
  var errorBox = document.getElementById('error-box');
  var successBox = document.getElementById('success-box');
  var passwordToggle = document.getElementById('password-toggle');

  CresceForteAuth.wirePasswordToggle(passwordInput, passwordToggle);

  function showError(message) {
    successBox.hidden = true;
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function showSuccess(message) {
    errorBox.hidden = true;
    successBox.textContent = message;
    successBox.hidden = false;
  }

  // If already signed in, skip the form and go straight to the right place.
  CresceForteAuth.getSession().then(function (session) {
    if (session) {
      CresceForteAuth.routeForUserType(CresceForteAuth.getUserType(session));
    }
  });

  emailInput.addEventListener('input', clearError);
  passwordInput.addEventListener('input', clearError);

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    var email = emailInput.value.trim();
    var password = passwordInput.value;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando...';

    try {
      var result = await CresceForteAuth.client.auth.signInWithPassword({ email: email, password: password });
      if (result.error) {
        showError('E-mail ou senha incorretos.');
        return;
      }
      var user = result.data && result.data.user;
      var userType = user && user.app_metadata ? user.app_metadata.user_type : undefined;
      CresceForteAuth.routeForUserType(userType);
    } catch (err) {
      console.error('Login error:', err);
      showError('Não foi possível entrar agora. Tente novamente em instantes.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar';
    }
  });

  forgotBtn.addEventListener('click', async function () {
    var email = emailInput.value.trim();
    if (!email) {
      showError('Digite seu e-mail acima antes de pedir a recuperação de senha.');
      emailInput.focus();
      return;
    }

    forgotBtn.disabled = true;
    forgotBtn.textContent = 'Enviando...';

    try {
      var result = await CresceForteAuth.client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password/'
      });
      if (result.error) {
        showError('Não foi possível enviar o e-mail de recuperação agora. Tente novamente em instantes.');
        return;
      }
      showSuccess('Se ' + email + ' tiver uma conta, enviamos um link para redefinir a senha.');
    } catch (err) {
      console.error('Reset password request error:', err);
      showError('Não foi possível enviar o e-mail de recuperação agora. Tente novamente em instantes.');
    } finally {
      forgotBtn.disabled = false;
      forgotBtn.textContent = 'Esqueci minha senha';
    }
  });
})();
