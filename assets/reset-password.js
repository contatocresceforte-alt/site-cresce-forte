// assets/reset-password.js — page logic for /reset-password/. Requires supabase-js + auth.js loaded first.
(function () {
  var titleEl = document.getElementById('card-title');
  var subEl = document.getElementById('card-sub');
  var form = document.getElementById('reset-form');
  var passwordInput = document.getElementById('password');
  var passwordConfirmInput = document.getElementById('password-confirm');
  var submitBtn = document.getElementById('submit-btn');
  var errorBox = document.getElementById('error-box');
  var successBox = document.getElementById('success-box');
  var rulesList = document.getElementById('password-rules');

  // Cliente só desta tela, criado só aqui (nunca em auth.js, que roda em toda
  // página): lê o #access_token=... da URL mas mantém a sessão de recuperação
  // SÓ EM MEMÓRIA (persistSession: false). Se a pessoa abandonar a tela nada
  // fica no localStorage e a sessão real dela não é tocada; storageKey próprio
  // evita o aviso de duas instâncias na mesma chave. A barreira é a rota + a
  // memória, NÃO o campo type do fragmento (quem escreve a URL escreve esse
  // campo). O cliente principal (auth.js) não lê o fragmento da URL.
  var recoveryClient = window.supabase.createClient(CresceForteAuth.SUPABASE_URL, CresceForteAuth.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: true,
      storageKey: 'cf-recovery-memory'
    }
  });

  CresceForteAuth.wirePasswordToggle(passwordInput, document.getElementById('password-toggle'));
  CresceForteAuth.wirePasswordToggle(passwordConfirmInput, document.getElementById('password-confirm-toggle'));

  // Same rules the Supabase Auth password policy enforces server-side —
  // shown and checked live so the user sees what's missing before submitting,
  // not just a rejection after the fact.
  var PASSWORD_RULES = [
    { test: function (p) { return p.length >= 8; }, label: 'Mínimo de 8 caracteres' },
    { test: function (p) { return /[a-z]/.test(p); }, label: 'Uma letra minúscula' },
    { test: function (p) { return /[A-Z]/.test(p); }, label: 'Uma letra maiúscula' },
    { test: function (p) { return /[^A-Za-z0-9]/.test(p); }, label: 'Um caractere especial (ex: !@#$%)' }
  ];
  PASSWORD_RULES.forEach(function (rule) {
    var li = document.createElement('li');
    li.textContent = rule.label + ' ';
    // Texto só pra leitor de tela — a marcação visual (cor + risco) some
    // pra quem não distingue cor, e não tem aria-live na lista inteira de
    // propósito (anunciaria a cada tecla digitada, virando ruído).
    var status = document.createElement('span');
    status.className = 'cf-rule-status';
    li.appendChild(status);
    rulesList.appendChild(li);
  });
  function updateRules() {
    var password = passwordInput.value;
    PASSWORD_RULES.forEach(function (rule, i) {
      var ok = rule.test(password);
      var li = rulesList.children[i];
      li.classList.toggle('cf-rule-ok', ok);
      li.querySelector('.cf-rule-status').textContent = ok ? '(atendido)' : '';
    });
  }
  function passwordMeetsRules(password) {
    return PASSWORD_RULES.every(function (rule) { return rule.test(password); });
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  // Supabase's recovery link puts a token in the URL and, once the recovery
  // client picks it up, fires PASSWORD_RECOVERY with a real (but short-lived)
  // in-memory session — that's our cue to show the "set new password" form
  // instead of the default "confirming..." message. Qualquer outro evento
  // (fragmento com outro type ou sem recuperação) é ignorado: a tela cai no
  // "link inválido" abaixo.
  var recoveryReady = false;

  recoveryClient.auth.onAuthStateChange(function (event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryReady = true;
      // Mostra de QUEM é a sessão de recuperação: um link forjado com tokens
      // de outra conta cai aqui igual a um legítimo, e o e-mail é a única
      // pista que a pessoa tem de que não é a conta dela.
      var accountEmail = session && session.user && session.user.email;
      subEl.textContent = accountEmail
        ? 'Escolha uma nova senha para a conta ' + accountEmail + '. Se esse não é o seu e-mail, feche esta página.'
        : 'Escolha uma nova senha para sua conta.';
      form.hidden = false;
    }
  });

  // If the link was already invalid/expired, Supabase redirects here with
  // #error=... instead of a session — surface that instead of hanging on
  // "confirming...". error_description is attacker-controlled free text
  // (comes straight from the URL fragment) — never render it. Match error
  // against a closed set and show our own copy for each.
  var ERROR_MESSAGES = {
    access_denied: 'Esse link de recuperação expirou ou já foi usado. Peça um novo.',
    otp_expired: 'Esse link de recuperação expirou. Peça um novo.'
  };
  var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (hashParams.get('error')) {
    titleEl.textContent = 'Link inválido';
    subEl.textContent = 'Esse link de recuperação expirou ou já foi usado. Peça um novo.';
    showError(ERROR_MESSAGES[hashParams.get('error_code')] || 'Link inválido ou expirado.');
  } else {
    // Give onAuthStateChange a moment to fire before assuming there is no token at all.
    setTimeout(function () {
      if (!recoveryReady && form.hidden) {
        titleEl.textContent = 'Link inválido';
        subEl.textContent = 'Abra esta página a partir do link enviado por e-mail.';
        showError('Não encontramos um link de recuperação válido nesta página.');
      }
    }, 4000);
  }

  passwordInput.addEventListener('input', function () { clearError(); updateRules(); });
  passwordConfirmInput.addEventListener('input', clearError);

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    var password = passwordInput.value;
    var confirm = passwordConfirmInput.value;

    if (!passwordMeetsRules(password)) {
      showError('A senha não atende aos requisitos listados acima.');
      return;
    }
    if (password !== confirm) {
      showError('As senhas não conferem.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando...';

    try {
      var result = await recoveryClient.auth.updateUser({ password: password });
      if (result.error) {
        showError('Não foi possível salvar a nova senha: ' + result.error.message);
        return;
      }
      form.hidden = true;
      successBox.hidden = false;
      successBox.textContent = 'Senha atualizada! Entre com a nova senha.';

      // Sem login automático: a sessão de recuperação só existe em memória e
      // morre com a página; a pessoa entra pelo login normal.
      setTimeout(function () { window.location.href = '/login/'; }, 1500);
    } catch (err) {
      console.error('Reset password error:', err);
      showError('Não foi possível salvar a nova senha agora. Tente novamente em instantes.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Salvar nova senha';
    }
  });
})();
