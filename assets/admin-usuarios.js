// assets/admin-usuarios.js — seção "Usuários" dentro do "Gerenciar" de cada
// empresa no /admin/ (pedido do Alain, 27/09). Carrega depois de auth.js e
// antes de admin.js; admin.js chama CresceForteAdminUsuarios.montar().
// DOM só com createElement/textContent: a CSP do Cloudflare (style-src
// 'self') bloqueia style= e element.style. Todas as classes em admin-page.css.
(function () {
  // window.CF_API_BASE_DUBLE só existe na prévia local (dublê da API).
  var API_BASE = window.CF_API_BASE_DUBLE || 'https://crm.cresceforte.com/api';
  var PRAZO_MS = 20000;
  var ABAS = [['atendimentos', 'Inbox'], ['funil', 'Funil'], ['automacoes', 'Automações'], ['contatos', 'Contatos'], ['painel', 'Painel'], ['config', 'Ajustes']];
  var ESTADOS = { ativo: 'Ativo', convite_pendente: 'Convite pendente', bloqueado: 'Bloqueado', desativado: 'Desativado' };
  var seq = 0;

  function el(tag, classe, texto) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  function botao(texto, classe, aoClicar) {
    var b = el('button', classe || 'cf-secondary-btn cf-btn-sm', texto);
    b.type = 'button';
    b.addEventListener('click', aoClicar);
    return b;
  }
  function novoId() { seq += 1; return 'cf-u-' + seq; }
  function entrada(tipo, valor, max) {
    var i = el('input');
    i.type = tipo; i.id = novoId(); i.autocomplete = 'off'; i.maxLength = max;
    if (valor) i.value = valor;
    return i;
  }
  function campo(rotulo, controle) {
    var wrap = el('div', 'cf-field');
    var label = el('label', null, rotulo);
    label.htmlFor = controle.id;
    wrap.appendChild(label);
    wrap.appendChild(controle);
    return wrap;
  }
  function seletorPapel(valor) {
    var s = el('select', 'cf-status-select');
    s.id = novoId();
    ['Atendente', 'Administrador'].forEach(function (p) {
      var o = el('option', null, p);
      o.value = p;
      if (p === valor) o.selected = true;
      s.appendChild(o);
    });
    return s;
  }
  function caixa(rotulo, marcada, valor) {
    var c = el('input');
    c.type = 'checkbox'; c.id = novoId(); c.checked = marcada;
    if (valor) c.value = valor;
    var l = el('label', 'cf-check');
    l.htmlFor = c.id;
    l.appendChild(c);
    l.appendChild(document.createTextNode(' ' + rotulo));
    return { input: c, label: l };
  }
  function caminho(companyId, atendenteId, sufixo) {
    return '/plataforma/empresas/' + encodeURIComponent(companyId) + '/usuarios' +
      (atendenteId ? '/' + encodeURIComponent(atendenteId) : '') + (sufixo || '');
  }

  // { ok, status, corpo }. Lança Error com texto pronto para a tela.
  function chamarApi(metodo, rota, corpo) {
    return CresceForteAuth.client.auth.getSession().then(function (r) {
      var token = r && r.data && r.data.session && r.data.session.access_token;
      if (!token) throw new Error('Sua sessão expirou. Entre de novo.');
      var controle = new AbortController();
      var prazo = setTimeout(function () { controle.abort(); }, PRAZO_MS);
      var opcoes = { method: metodo, headers: { Authorization: 'Bearer ' + token }, signal: controle.signal };
      if (corpo !== undefined) {
        opcoes.headers['Content-Type'] = 'application/json';
        opcoes.body = JSON.stringify(corpo);
      }
      return fetch(API_BASE + rota, opcoes)
        .then(function (res) {
          if (res.status === 204) return { ok: true, status: 204, corpo: null };
          return res.json().catch(function () { return {}; }).then(function (json) {
            return { ok: res.ok, status: res.status, corpo: json };
          });
        }, function (erro) {
          if (erro && erro.name === 'AbortError') throw new Error('O servidor não respondeu a tempo. Recarregue a lista antes de tentar de novo.');
          throw new Error('Não consegui falar com o servidor. Confira a conexão e tente de novo.');
        })
        .finally(function () { clearTimeout(prazo); });
    });
  }
  function mensagemDeErro(r) {
    return (r.corpo && r.corpo.erro && r.corpo.erro.mensagem) || ('Algo deu errado (código ' + r.status + ').');
  }

  var dialogo = null;
  function abrirDialogo(titulo, montar) {
    if (!dialogo) {
      dialogo = el('dialog', 'cf-dialog');
      // Fechou: some com tudo, inclusive senha provisória que estivesse na tela.
      // O evento 'close' chega numa tarefa DEPOIS do close(); se outro diálogo
      // já abriu nesse meio-tempo, o conteúdo é o novo e fica (abrirDialogo já
      // limpou o antigo). Sem o `open`, o diálogo novo abria vazio.
      dialogo.addEventListener('close', function () { if (!dialogo.open) dialogo.textContent = ''; });
      document.body.appendChild(dialogo);
    }
    dialogo.textContent = '';
    dialogo.appendChild(el('h3', 'cf-dialog-title', titulo));
    var corpo = el('div', 'cf-dialog-body');
    dialogo.appendChild(corpo);
    montar(corpo, function () { if (dialogo.open) dialogo.close(); });
    dialogo.showModal();
  }

  // `enviar` devolve uma Promise; { erro: 'texto' } mantém o diálogo aberto com a mensagem.
  function formulario(corpo, controles, rotuloEnviar, enviar, fechar) {
    var form = el('form', 'cf-dialog-form');
    form.method = 'dialog';
    form.noValidate = true;
    controles.forEach(function (c) { form.appendChild(c); });
    var acoes = el('div', 'cf-form-actions');
    var ok = el('button', 'cf-primary-btn', rotuloEnviar);
    ok.type = 'submit';
    acoes.appendChild(ok);
    acoes.appendChild(botao('Cancelar', 'cf-secondary-btn', fechar));
    var msg = el('p', 'cf-form-msg');
    msg.hidden = true;
    msg.setAttribute('role', 'status');
    form.appendChild(acoes);
    form.appendChild(msg);
    function falhou(texto) {
      msg.className = 'cf-form-msg cf-form-msg-error';
      msg.textContent = texto;
      msg.hidden = false;
      ok.disabled = false;
    }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      ok.disabled = true;
      msg.hidden = true;
      enviar().then(function (r) { if (r && r.erro) falhou(r.erro); }, function (erro) { falhou(erro.message); });
    });
    corpo.appendChild(form);
  }

  function senhaUmaVez(corpo, senha, fechar) {
    corpo.textContent = '';
    corpo.appendChild(el('p', 'cf-form-msg cf-form-msg-ok', 'Senha provisória — aparece só agora. Passe para o usuário; ele troca em "Meu perfil".'));
    var wrap = el('span', 'cf-inline-pwd');
    var valor = el('span', 'cf-inline-pwd-value');
    function render(revelada) { valor.textContent = revelada ? senha : '••••••••••'; }
    render(false);
    var olho = el('button', 'cf-reveal-btn');
    olho.type = 'button';
    olho.setAttribute('aria-label', 'Mostrar senha provisória');
    olho.setAttribute('aria-pressed', 'false');
    olho.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + CresceForteAuth.EYE_OPEN + '</svg>';
    CresceForteAuth.wireEyeToggle(olho, render, { show: 'Mostrar senha provisória', hide: 'Esconder senha provisória' });
    var copiar = botao('Copiar', 'cf-secondary-btn cf-btn-sm', function () {
      navigator.clipboard.writeText(senha).then(function () { copiar.textContent = 'Copiada'; }, function () { copiar.textContent = 'Copie à mão'; });
    });
    wrap.appendChild(valor);
    wrap.appendChild(olho);
    wrap.appendChild(copiar);
    corpo.appendChild(wrap);
    var acoes = el('div', 'cf-form-actions');
    acoes.appendChild(botao('Fechar', 'cf-primary-btn', fechar));
    corpo.appendChild(acoes);
  }

  function confirmar(titulo, texto, rotulo, metodo, rota, recarregar) {
    abrirDialogo(titulo, function (corpo, fechar) {
      formulario(corpo, [el('p', 'cf-dialog-text', texto)], rotulo, function () {
        return chamarApi(metodo, rota).then(function (r) {
          if (!r.ok) return { erro: mensagemDeErro(r) };
          fechar();
          recarregar();
        });
      }, fechar);
    });
  }

  function abrirAdicionar(companyId, recarregar) {
    abrirDialogo('Adicionar usuário', function (corpo, fechar) {
      var nome = entrada('text', '', 120);
      var email = entrada('email', '', 200);
      var papel = seletorPapel('Atendente');
      formulario(corpo, [campo('Nome *', nome), campo('E-mail de acesso *', email), campo('Papel', papel)], 'Adicionar', function () {
        if (!nome.value.trim() || !email.value.trim()) return Promise.resolve({ erro: 'Preencha nome e e-mail.' });
        return chamarApi('POST', caminho(companyId), { nome: nome.value.trim(), email: email.value.trim(), papel: papel.value }).then(function (r) {
          if (!r.ok) return { erro: mensagemDeErro(r) };
          senhaUmaVez(corpo, r.corpo.dados.senhaTemporaria, fechar);
          recarregar();
        });
      }, fechar);
    });
  }

  function abrirEditar(companyId, usuario, recarregar) {
    abrirDialogo('Editar ' + usuario.nome, function (corpo, fechar) {
      var nome = entrada('text', usuario.nome, 120);
      var email = entrada('email', usuario.email || '', 200);
      var papel = seletorPapel(usuario.papel);
      formulario(corpo, [campo('Nome', nome), campo('E-mail de acesso', email), campo('Papel', papel)], 'Salvar', function () {
        var mudancas = {};
        if (nome.value.trim() && nome.value.trim() !== usuario.nome) mudancas.nome = nome.value.trim();
        if (email.value.trim() && email.value.trim().toLowerCase() !== String(usuario.email || '').toLowerCase()) mudancas.email = email.value.trim();
        if (papel.value !== usuario.papel) mudancas.papel = papel.value;
        if (!Object.keys(mudancas).length) { fechar(); return Promise.resolve(); }
        return chamarApi('PATCH', caminho(companyId, usuario.id), mudancas).then(function (r) {
          if (!r.ok) return { erro: mensagemDeErro(r) };
          fechar();
          recarregar();
        });
      }, fechar);
    });
  }

  function abrirAcesso(companyId, usuario, recarregar) {
    abrirDialogo('Acesso de ' + usuario.nome, function (corpo, fechar) {
      var atual = usuario.acessoRestrito;
      var controles = [el('p', 'cf-dialog-text', atual ? 'Acesso restrito às abas marcadas.' : 'Hoje tem acesso total. Desmarque para restringir.')];
      var abas = ABAS.map(function (par) { return caixa(par[1], !atual || atual.abas.indexOf(par[0]) !== -1, par[0]); });
      abas.forEach(function (x) { controles.push(x.label); });
      var catalogo = caixa('Acessa o Catálogo', !atual || atual.catalogAccess);
      controles.push(catalogo.label);
      if (atual) {
        var voltar = botao('Voltar ao acesso total', 'cf-secondary-btn cf-btn-sm', function () {
          voltar.disabled = true;
          chamarApi('DELETE', caminho(companyId, usuario.id, '/acesso')).then(function (r) {
            if (!r.ok) { voltar.disabled = false; voltar.textContent = mensagemDeErro(r); return; }
            fechar();
            recarregar();
          }, function (erro) { voltar.disabled = false; voltar.textContent = erro.message; });
        });
        controles.push(voltar);
      }
      formulario(corpo, controles, 'Salvar', function () {
        var marcadas = abas.filter(function (x) { return x.input.checked; }).map(function (x) { return x.input.value; });
        return chamarApi('PUT', caminho(companyId, usuario.id, '/acesso'), { abas: marcadas, catalogAccess: catalogo.input.checked }).then(function (r) {
          if (!r.ok) return { erro: mensagemDeErro(r) };
          fechar();
          recarregar();
        });
      }, fechar);
    });
  }

  function abrirSenha(companyId, usuario) {
    abrirDialogo('Nova senha para ' + usuario.nome, function (corpo, fechar) {
      var texto = 'O sistema gera uma senha provisória e mostra só uma vez. A senha atual deixa de funcionar. Quem já está logado continua logado; para tirar alguém na hora, use Bloquear.';
      formulario(corpo, [el('p', 'cf-dialog-text', texto)], 'Gerar senha', function () {
        return chamarApi('POST', caminho(companyId, usuario.id, '/senha')).then(function (r) {
          if (!r.ok) return { erro: mensagemDeErro(r) };
          senhaUmaVez(corpo, r.corpo.dados.senhaTemporaria, fechar);
        });
      }, fechar);
    });
  }

  function linhaUsuario(companyId, usuario, recarregar) {
    var linha = el('div', 'cf-user-row' + (usuario.estado === 'desativado' ? ' cf-user-row-off' : ''));
    var info = el('div', 'cf-user-info');
    info.appendChild(el('span', 'cf-user-name', usuario.nome));
    info.appendChild(el('span', 'cf-user-meta', (usuario.email || 'sem e-mail') + ' · ' + usuario.papel + (usuario.acessoRestrito ? ' · acesso restrito' : '')));
    linha.appendChild(info);
    linha.appendChild(el('span', 'cf-status-badge cf-estado cf-estado-' + usuario.estado, ESTADOS[usuario.estado] || usuario.estado));
    var acoes = el('div', 'cf-user-actions');
    var nome = usuario.nome;
    if (usuario.estado === 'desativado') {
      acoes.appendChild(botao('Reativar', null, function () {
        confirmar('Reativar ' + nome + '?', 'Volta a ter acesso, com o papel e as restrições de antes.', 'Reativar', 'POST', caminho(companyId, usuario.id, '/reativar'), recarregar);
      }));
    } else {
      acoes.appendChild(botao('Editar', null, function () { abrirEditar(companyId, usuario, recarregar); }));
      acoes.appendChild(botao('Acesso', null, function () { abrirAcesso(companyId, usuario, recarregar); }));
      acoes.appendChild(botao('Senha', null, function () { abrirSenha(companyId, usuario); }));
      if (usuario.estado === 'bloqueado') {
        acoes.appendChild(botao('Desbloquear', null, function () {
          confirmar('Desbloquear ' + nome + '?', 'Volta a entrar no CRM, no Catálogo e no painel.', 'Desbloquear', 'POST', caminho(companyId, usuario.id, '/desbloquear'), recarregar);
        }));
      } else {
        acoes.appendChild(botao('Bloquear', null, function () {
          confirmar('Bloquear ' + nome + '?', 'Perde na hora o acesso ao CRM, ao Catálogo e ao login. Dá para desbloquear depois.', 'Bloquear', 'POST', caminho(companyId, usuario.id, '/bloquear'), recarregar);
        }));
      }
      acoes.appendChild(botao('Desativar', 'cf-secondary-btn cf-btn-sm cf-btn-danger', function () {
        confirmar('Desativar ' + nome + '?', 'Sai da lista e perde o acesso a tudo. As conversas dele voltam para a fila; vendas e histórico ficam. Dá para reativar em "Mostrar desativados".', 'Desativar', 'DELETE', caminho(companyId, usuario.id), recarregar);
      }));
    }
    linha.appendChild(acoes);
    return linha;
  }

  function montar(companyId, painel) {
    var secao = el('section', 'cf-users');
    var cabeca = el('div', 'cf-users-head');
    cabeca.appendChild(el('h3', 'cf-users-title', 'Usuários'));
    var mostrar = caixa('Mostrar desativados', false);
    mostrar.label.className = 'cf-users-toggle';
    cabeca.appendChild(mostrar.label);
    var lista = el('div', 'cf-users-list');
    var aviso = el('p', 'cf-loading', 'Carregando usuários...');
    function recarregar() {
      aviso.hidden = false;
      aviso.className = 'cf-loading';
      aviso.textContent = 'Carregando usuários...';
      return chamarApi('GET', caminho(companyId) + (mostrar.input.checked ? '?incluirDesativados=1' : ''))
        .then(function (r) {
          if (!r.ok) throw new Error(mensagemDeErro(r));
          lista.textContent = '';
          var usuarios = (r.corpo && r.corpo.dados) || [];
          if (!usuarios.length) { aviso.textContent = 'Nenhum usuário nesta empresa.'; return; }
          aviso.hidden = true;
          usuarios.forEach(function (x) { lista.appendChild(linhaUsuario(companyId, x, recarregar)); });
        })
        .catch(function (erro) {
          aviso.hidden = false;
          aviso.className = 'cf-error-text';
          aviso.textContent = erro.message;
        });
    }
    cabeca.appendChild(botao('Adicionar usuário', 'cf-primary-btn cf-btn-sm', function () { abrirAdicionar(companyId, recarregar); }));
    secao.appendChild(cabeca);
    secao.appendChild(aviso);
    secao.appendChild(lista);
    painel.appendChild(secao);
    mostrar.input.addEventListener('change', recarregar);
    recarregar();
  }

  window.CresceForteAdminUsuarios = { montar: montar };
})();
