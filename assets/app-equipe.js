// assets/app-equipe.js — tela "Equipe" do /app/ (pedido do Alain, 28/09): o
// administrador escolhe quais serviços (CRM, Catálogo) cada pessoa da empresa
// usa. Quem guarda e fiscaliza a regra é o CRM (cargo restrito,
// apps/api/src/lib/permissoes.js, e o Catálogo lê o mesmo cargo); esta tela só
// traduz caixa marcada em abas + catalogAccess. Carrega antes de app.js, que
// chama CresceForteEquipe.montar() quando /api/auth/servicos diz administrador.
// DOM só com createElement/textContent: a CSP do Cloudflare (style-src 'self')
// bloqueia style= e element.style. Classes em app-page.css.
(function () {
  // Mesma lista, mesma ordem de ABAS_CRM no CRM (lib/permissoes.js).
  var ABAS = ['atendimentos', 'funil', 'automacoes', 'contatos', 'painel', 'config'];
  var ROTULOS = { crm: 'CRM', catalogo: 'Catálogo' };
  var PRAZO_MS = 15000;

  function el(tag, classe, texto) {
    var e = document.createElement(tag);
    if (classe) { e.className = classe; }
    if (texto !== undefined) { e.textContent = texto; }
    return e;
  }

  // Serviços de uma pessoa, lidos do cargo restrito que o CRM devolve em
  // GET /v1/atendentes: sem cargo = os dois; com cargo, CRM = alguma aba
  // (o CRM põe crm.access sempre que há aba) e Catálogo = catalogAccess.
  function estadoDe(pessoa) {
    var r = pessoa.acessoRestrito;
    return { crm: !r || r.abas.length > 0, catalogo: !r || r.catalogAccess === true };
  }

  // Caixas → pedido. Os dois ligados e nenhuma aba cortada = acesso total
  // (DELETE apaga o cargo). Senão o cargo com as abas de antes (ou todas, se o
  // CRM estava desligado) e o Catálogo pedido. As abas finas continuam sendo
  // escolhidas dentro do CRM (Configurações → Equipe → Acesso).
  function pedidoPara(pessoa, novo) {
    var r = pessoa.acessoRestrito;
    var abas = r && r.abas.length ? r.abas : ABAS;
    if (novo.crm && novo.catalogo && abas.length === ABAS.length) { return { metodo: 'DELETE' }; }
    return { metodo: 'PATCH', corpo: { abas: novo.crm ? abas.slice() : [], catalogAccess: novo.catalogo } };
  }

  // { ok } → corpo; erro → Error com a frase para a tela (a do servidor
  // quando vier, que já diz o que fazer).
  function chamar(opcoes, metodo, rota, corpo) {
    var token = opcoes.token();
    if (!token) { return Promise.reject(new Error('Sua sessão expirou. Entre de novo.')); }
    var controle = window.AbortController ? new window.AbortController() : null;
    var prazo = setTimeout(function () { if (controle) { controle.abort(); } }, PRAZO_MS);
    var init = { method: metodo, headers: { Authorization: 'Bearer ' + token }, signal: controle ? controle.signal : undefined };
    if (corpo !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(corpo);
    }
    return fetch(opcoes.apiBase + rota, init).then(function (res) {
      clearTimeout(prazo);
      if (res.status === 204) { return null; }
      return res.json().catch(function () { return null; }).then(function (b) {
        if (res.ok) { return b; }
        var msg = b && b.erro && typeof b.erro.mensagem === 'string' ? b.erro.mensagem : 'Não consegui salvar agora. Tente de novo.';
        throw new Error(msg);
      });
    }, function () {
      clearTimeout(prazo);
      throw new Error('Não consegui falar com o servidor. Verifique a conexão e tente de novo.');
    });
  }

  function linha(opcoes, pessoa, chaves) {
    var row = el('div', 'cf-equipe-row');
    var info = el('div', 'cf-equipe-info');
    info.appendChild(el('span', 'cf-equipe-nome', pessoa.nome));
    if (pessoa.email) { info.appendChild(el('span', 'cf-equipe-meta', pessoa.email)); }
    if (pessoa.acessoLiberado === false) {
      info.appendChild(el('span', 'cf-equipe-meta cf-equipe-pendente', 'Aguardando liberação: libere no CRM, em Configurações → Equipe.'));
    }
    row.appendChild(info);
    var servicos = el('div', 'cf-equipe-servicos');
    row.appendChild(servicos);
    var erro = el('p', 'cf-equipe-erro');
    erro.hidden = true;
    erro.setAttribute('role', 'alert');
    row.appendChild(erro);

    if (pessoa.papel === 'Administrador') {
      servicos.appendChild(el('span', 'cf-equipe-tudo', 'Administrador · acesso a tudo'));
      return row;
    }

    var estado = estadoDe(pessoa);
    var caixas = {};
    // A última caixa ligada fica travada: nenhum serviço é Desativar, que
    // mora no CRM (o servidor também recusa, 400 sem_servico).
    function atualizar(ocupado) {
      var ligadas = chaves.filter(function (k) { return estado[k]; }).length;
      chaves.forEach(function (k) {
        caixas[k].checked = estado[k];
        caixas[k].disabled = ocupado || (estado[k] && ligadas === 1);
        caixas[k].parentNode.title = !ocupado && estado[k] && ligadas === 1
          ? 'Pelo menos um serviço fica ligado. Para tirar todo o acesso, desative a pessoa no CRM.' : '';
      });
    }
    chaves.forEach(function (k) {
      var id = 'cf-eq-' + pessoa.id + '-' + k;
      var caixa = el('input');
      caixa.type = 'checkbox';
      caixa.id = id;
      var rotulo = el('label', 'cf-equipe-check');
      rotulo.htmlFor = id;
      rotulo.appendChild(caixa);
      rotulo.appendChild(document.createTextNode(ROTULOS[k]));
      servicos.appendChild(rotulo);
      caixas[k] = caixa;
      caixa.addEventListener('change', function () {
        var novo = { crm: estado.crm, catalogo: estado.catalogo };
        novo[k] = caixa.checked;
        var pedido = pedidoPara(pessoa, novo);
        erro.hidden = true;
        atualizar(true);
        caixa.checked = novo[k];
        chamar(opcoes, pedido.metodo, '/v1/atendentes/' + encodeURIComponent(pessoa.id) + '/acesso', pedido.corpo)
          .then(function () {
            pessoa.acessoRestrito = pedido.metodo === 'DELETE' ? null : pedido.corpo;
            estado = estadoDe(pessoa);
          })
          .catch(function (e) {
            erro.textContent = e.message;
            erro.hidden = false;
          })
          .then(function () { atualizar(false); });
      });
    });
    atualizar(false);
    return row;
  }

  function montar(area, opcoes) {
    area.textContent = '';
    area.appendChild(el('span', 'cf-overline cf-kicker', 'Sua equipe'));
    var titulo = el('h1', null, 'Equipe');
    titulo.id = 'equipe-titulo';
    area.appendChild(titulo);
    area.appendChild(el('p', 'cf-sub', 'Escolha quais serviços cada pessoa da sua empresa pode usar. Quem é convidado pelo CRM começa só com o CRM. Administradores usam todos.'));
    var lista = el('div', 'cf-equipe-lista');
    lista.setAttribute('aria-live', 'polite');
    lista.appendChild(el('p', 'cf-equipe-aviso', 'Carregando a equipe...'));
    area.appendChild(lista);

    var chaves = opcoes.servicos.map(function (s) { return s.key; }).filter(function (k) { return ROTULOS[k]; });
    chamar(opcoes, 'GET', '/v1/atendentes').then(function (b) {
      var pessoas = (b && b.dados) || [];
      lista.textContent = '';
      if (!pessoas.length) {
        lista.appendChild(el('p', 'cf-equipe-aviso', 'Ninguém na equipe ainda. Convide pelo CRM, em Configurações → Equipe.'));
        return;
      }
      pessoas.forEach(function (p) { lista.appendChild(linha(opcoes, p, chaves)); });
    }).catch(function (e) {
      lista.textContent = '';
      lista.appendChild(el('p', 'cf-equipe-aviso cf-equipe-erro', e.message));
      var denovo = el('button', 'cf-equipe-btn', 'Tentar de novo');
      denovo.type = 'button';
      denovo.addEventListener('click', function () { montar(area, opcoes); });
      lista.appendChild(denovo);
    });
  }

  window.CresceForteEquipe = { montar: montar };
})();
