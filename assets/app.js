// assets/app.js — page logic for /app/. Requires supabase-js + auth.js loaded first.
(function () {
  // URL de cada módulo já publicado. ticketUrl emite um ticket opaco de uso
  // único (~2min) que o próprio destino confere contra o e-mail digitado no
  // segundo login — trava troca de conta sem querer entre módulos. Sem
  // emissor central: cada destino expõe o próprio endpoint (decisão dos 3
  // repos, ver "Erro — Segundo login do Catálogo aceita conta de outra
  // empresa" no vault). Se a emissão falhar por qualquer motivo, abre a URL
  // normal sem ticket — mesmo comportamento de hoje, login pede de novo sem
  // travar ninguém fora.
  var MODULE_INFO = {
    crm: { url: 'https://crm.cresceforte.com/', ticketUrl: 'https://crm.cresceforte.com/api/auth/portal-ticket', desc: 'Converse com clientes, gerencie seu funil de vendas e seu catálogo de produtos.' },
    catalogo: { url: 'https://catalogo.cresceforte.com/', ticketUrl: 'https://catalogo.cresceforte.com/catalog-editor-api/portal-ticket', desc: 'Monte e publique seu catálogo digital.' }
  };

  function openModule(info, accessToken) {
    if (!info.ticketUrl || !accessToken) { window.open(info.url, '_blank', 'noopener'); return; }
    // Abre a aba já na hora do clique (gesto síncrono do usuário) e só troca
    // a URL depois — window.open() chamado só depois do fetch resolver
    // (assíncrono) é bloqueado por popup blocker em navegador de verdade.
    // 'noopener' aqui faria window.open() retornar null (spec atual), então
    // a gente perderia a referência e cairia sempre no fallback assíncrono —
    // abre sem a feature e zera .opener manualmente, mesmo efeito de
    // segurança sem perder a referência à aba.
    var tab = window.open('', '_blank');
    if (tab) { tab.opener = null; }
    var controller = window.AbortController ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 4000) : null;
    fetch(info.ticketUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken },
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var dest = data && data.ticket ? info.url + '?ticket=' + encodeURIComponent(data.ticket) : info.url;
        if (tab) { tab.location = dest; } else { window.open(dest, '_blank', 'noopener'); }
      })
      .catch(function () {
        if (tab) { tab.location = info.url; } else { window.open(info.url, '_blank', 'noopener'); }
      })
      .finally(function () { if (timeoutId) clearTimeout(timeoutId); });
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
