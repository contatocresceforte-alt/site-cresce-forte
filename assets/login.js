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

  // Sem o supabase-js (CDN fora do ar, rede da loja bloqueando, integrity
  // reprovando), auth.js lanca e CresceForteAuth nem existe. Sem esta saida,
  // a linha seguinte lançava ReferenceError, o resto do arquivo nunca rodava
  // e a tela ficava viva e muda: a pessoa digitava a senha e clicava sem
  // nada acontecer. Aqui ela para antes, com o motivo na tela.
  if (!window.CresceForteAuth) {
    errorBox.textContent = 'Não foi possível carregar o login agora. Verifique sua conexão e recarregue a página.';
    errorBox.hidden = false;
    submitBtn.disabled = true;
    forgotBtn.disabled = true;
    return;
  }

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

  // A trava mora no handler, não no botão: `disabled` é aviso visual e não
  // cobre todo caminho de envio. Um segundo envio pode entrar enquanto o
  // primeiro está no ar, ou enquanto a página já está saindo depois do sucesso.
  //
  // Honestidade sobre o que foi medido: o envio duplo foi observado chamando o
  // handler direto (dois `signInWithPassword`), o que prova reentrância do
  // handler — NÃO prova que o Enter fura um botão desabilitado. A Esther leu a
  // especificação: com botão de submit presente, o envio implícito dispara um
  // clique nele, e clique em botão desabilitado não faz nada. Não consegui
  // medir isso: o teclado do navegador embutido não produz envio implícito nem
  // num formulário SEM botão (controle deu 0). A trava fica de qualquer jeito,
  // porque ela não depende de qual das duas explicações vale.
  var enviando = false;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (enviando) { return; }
    enviando = true;
    clearError();

    var email = emailInput.value.trim();
    var password = passwordInput.value;

    var saindo = false;
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
      // A navegação é assíncrona: a página ainda fica no ar por um tempo depois
      // desta linha. Devolver o botão para "Entrar" aqui faz a tela dizer que
      // nada aconteceu, e um segundo clique dispara outro signInWithPassword —
      // medido, duas chamadas. Enquanto está saindo, o botão continua travado.
      saindo = true;
      CresceForteAuth.routeForUserType(userType);
    } catch (err) {
      console.error('Login error:', err);
      showError('Não foi possível entrar agora. Tente novamente em instantes.');
    } finally {
      if (!saindo) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Entrar';
      }
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
