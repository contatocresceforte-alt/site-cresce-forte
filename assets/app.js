// assets/app.js — page logic for /app/. Requires supabase-js + auth.js loaded first.
(function () {
  // URL de cada módulo já publicado. ticketUrl emite um ticket opaco de uso
  // único (~2min) que o próprio destino confere contra o e-mail digitado no
  // segundo login — trava troca de conta sem querer entre módulos. Sem
  // emissor central: cada destino expõe o próprio endpoint (decisão dos 3
  // repos, ver "Erro — Segundo login do Catálogo aceita conta de outra
  // empresa" no vault).
  //
  // PROPOSTA (item 2 + contrato portal-handoff v1, aprovado pela Esther; não
  // subir sem CRM/Catálogo estarem com o lado do módulo pronto e o smoke test
  // feito com o Alain): o ticket NUNCA vai na URL. A aba do módulo abre em
  // "<módulo>/#portal" e o ticket chega por postMessage, só com
  // targetOrigin = origem exata do módulo. Se a emissão falhar não existe
  // mais "URL normal sem ticket": o módulo recebe cf-portal-fail e segue no
  // login nativo (enquanto ele existir).
  var MODULE_INFO = {
    crm: { url: 'https://crm.cresceforte.com/', ticketUrl: 'https://crm.cresceforte.com/api/auth/portal-ticket', desc: 'Converse com clientes, gerencie seu funil de vendas e seu catálogo de produtos.' },
    catalogo: { url: 'https://catalogo.cresceforte.com/', ticketUrl: 'https://catalogo.cresceforte.com/catalog-editor-api/portal-ticket', desc: 'Monte e publique seu catálogo digital.' }
  };

  var RESEND_MS = 250;
  var HANDSHAKE_MS = 10000;
  var MSG_BLOCKED = 'Seu navegador bloqueou a nova aba. Permita pop-ups ou abra no navegador.';
  var MSG_HANDSHAKE = 'Não foi possível abrir pelo portal. Tente de novo ou abra pelo navegador.';

  // Os módulos recusam token com iat velho (~5 min) e conferem no Supabase que
  // a sessão ainda existe; renovar antes de pedir o ticket evita a recusa. Se a
  // renovação falhar ou demorar (3s), segue com o token atual — quem decide se
  // emite ou não o ticket é o servidor do módulo, não este arquivo.
  function freshAccessToken(current) {
    var refresh = CresceForteAuth.client.auth.refreshSession().then(function (r) {
      return r && r.data && r.data.session ? r.data.session.access_token : current;
    }).catch(function () { return current; });
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(current); }, 3000); });
    return Promise.race([refresh, timeout]);
  }

  // Erro na própria página do hub: a aba do módulo já está em outra origem e
  // não dá pra escrever nela.
  function showHubError(message) {
    var box = document.getElementById('portal-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'portal-error';
      box.className = 'cf-placeholder';
      box.setAttribute('role', 'alert');
      var area = document.getElementById('modules-area');
      area.parentNode.insertBefore(box, area);
    }
    box.textContent = message;
  }

  // Manda `message` para a aba do módulo a cada 250 ms (a aba ainda pode estar
  // carregando e sem listener) até o ack, até a aba fechar ou até 10 s.
  // targetOrigin é sempre a origem exata do módulo, nunca '*'. O ack só vale
  // se vier dessa origem E da própria aba aberta (event.source === tab).
  // `onTimeout` roda só se estourar os 10 s sem ack.
  function deliver(tab, origin, message, onTimeout) {
    var timer, limit;
    function send() { try { tab.postMessage(message, origin); } catch (e) { /* aba já navegou/fechou */ } }
    function stop() {
      clearInterval(timer);
      clearTimeout(limit);
      window.removeEventListener('message', onMessage);
    }
    function onMessage(ev) {
      if (ev.origin !== origin || ev.source !== tab) { return; }
      var d = ev.data;
      if (d && typeof d === 'object' && d.type === 'cf-portal-ack' && d.v === 1) { stop(); }
    }
    window.addEventListener('message', onMessage);
    send();
    timer = setInterval(function () {
      if (tab.closed) { stop(); return; }
      send();
    }, RESEND_MS);
    limit = setTimeout(function () { stop(); if (onTimeout) { onTimeout(); } }, HANDSHAKE_MS);
  }

  function openModule(info, accessToken) {
    if (!info.ticketUrl || !accessToken) { window.open(info.url, '_blank', 'noopener'); return; }
    var origin = new URL(info.url).origin;
    // Abre a aba já na hora do clique (gesto síncrono do usuário) — window.open()
    // chamado só depois do fetch resolver (assíncrono) é bloqueado por popup
    // blocker em navegador de verdade. 'noopener' aqui faria window.open()
    // retornar null (spec atual) e perderíamos a referência que o postMessage
    // precisa; abre sem a feature e zera .opener manualmente (o módulo não
    // alcança o hub, a referência hub→aba continua).
    var tab = window.open(info.url + '#portal', '_blank');
    if (!tab) { showHubError(MSG_BLOCKED); return; }
    // Alguns motores podem lançar SecurityError aqui; sem o try/catch a função
    // abortaria antes de entregar o ticket. O hub segue mesmo assim.
    try { tab.opener = null; } catch (e) { /* segue para a entrega */ }
    var controller = null;
    var timeoutId = null;

    freshAccessToken(accessToken)
      .then(function (token) {
        controller = window.AbortController ? new AbortController() : null;
        timeoutId = controller ? setTimeout(function () { controller.abort(); }, 4000) : null;
        return fetch(info.ticketUrl, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          signal: controller ? controller.signal : undefined
        });
      })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        if (timeoutId) { clearTimeout(timeoutId); }
        // O ticket só existe dentro desta closure; nada de log dele nem da mensagem.
        if (data && typeof data.ticket === 'string' && data.ticket) {
          deliver(tab, origin, { type: 'cf-portal-ticket', v: 1, ticket: data.ticket }, function () { showHubError(MSG_HANDSHAKE); });
        } else {
          deliver(tab, origin, { type: 'cf-portal-fail', v: 1 });
        }
      });
  }

  function renderModules(rows, accessToken) {
    var area = document.getElementById('modules-area');
    area.innerHTML = '';
    if (!rows || !rows.length) {
      area.innerHTML = '<div class="cf-placeholder"><span class="cf-tag">Nenhum módulo</span><h2>Nenhum serviço ativo</h2><p>Fale com o suporte da Cresce Forte para ativar um módulo para sua empresa.</p></div>';
      return;
    }
    rows.forEach(function (row) {
      var svc = row.services;
      var info = MODULE_INFO[svc.key] || {};
      var card = document.createElement(info.url ? 'button' : 'div');
      card.className = 'cf-module';
      if (info.url) {
        card.type = 'button';
        card.addEventListener('click', function () { openModule(info, accessToken); });
      }
      var h2 = document.createElement('h2');
      h2.textContent = svc.name;
      var p = document.createElement('p');
      p.textContent = info.desc || 'Módulo ativo para sua empresa.';
      var tag = document.createElement('span');
      tag.className = 'cf-open';
      if (info.url) {
        tag.textContent = 'Abrir →';
      } else {
        tag.textContent = 'Em configuração';
        tag.classList.add('cf-open-muted');
      }
      card.appendChild(h2);
      card.appendChild(p);
      card.appendChild(tag);
      area.appendChild(card);
    });
  }

  // validatedSession em vez de requireAuth: duas linhas abaixo, o
  // app_metadata.company_id desta sessão vira o filtro dos módulos exibidos.
  // Sessão lida só do localStorage é forjável pelo console do navegador —
  // aqui ela é confirmada com o servidor do Supabase antes de virar decisão
  // de tela. Quem de fato impede ler os módulos de outra empresa é a RLS de
  // company_services; isto só evita a tela mentir.
  CresceForteAuth.validatedSession().then(async function (session) {
    if (!session) {
      window.location.href = '/login/';
      return;
    }
    var emailEl = document.getElementById('user-email');
    var name = session.user.user_metadata && session.user.user_metadata.full_name;
    emailEl.textContent = name || session.user.email || '';

    var companyId = CresceForteAuth.getCompanyId(session);
    if (!companyId) { renderModules([]); return; }

    var result = await CresceForteAuth.client
      .from('company_services')
      .select('active, services(key, name)')
      .eq('company_id', companyId)
      .eq('active', true);

    if (result.error) {
      console.error('Erro ao buscar módulos:', result.error);
      document.getElementById('modules-area').innerHTML =
        '<div class="cf-placeholder"><span class="cf-tag">Erro</span><h2>Não foi possível carregar seus módulos</h2><p>Atualize a página em instantes.</p></div>';
      return;
    }
    renderModules(result.data, session.access_token);
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    CresceForteAuth.logout('/login/');
  });
})();
