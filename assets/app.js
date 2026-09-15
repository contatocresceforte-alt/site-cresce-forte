// assets/app.js — page logic for /app/. Requires supabase-js + auth.js loaded first.
(function () {
  // URL de cada módulo já publicado.
  // Login do CRM continua sendo o dele mesmo (ponte bcrypt, Fase 4 do plano
  // ainda não trocou isso) — abrir aqui não loga sozinho lá, é aba separada.
  var MODULE_INFO = {
    crm: { url: 'https://crm.cresceforte.com/', desc: 'Converse com clientes, gerencie seu funil de vendas e seu catálogo de produtos.' },
    catalogo: { url: 'https://catalogo.cresceforte.com/', desc: 'Monte e publique seu catálogo digital.' }
  };

  function renderModules(rows) {
    var area = document.getElementById('modules-area');
    area.innerHTML = '';
    if (!rows || !rows.length) {
      area.innerHTML = '<div class="cf-placeholder"><span class="cf-tag">Nenhum módulo</span><h2>Nenhum serviço ativo</h2><p>Fale com o suporte da Cresce Forte para ativar um módulo para sua empresa.</p></div>';
      return;
    }
    rows.forEach(function (row) {
      var svc = row.services;
      var info = MODULE_INFO[svc.key] || {};
      var card = document.createElement(info.url ? 'a' : 'div');
      card.className = 'cf-module';
      if (info.url) { card.href = info.url; card.target = '_blank'; card.rel = 'noopener'; }
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
        tag.style.color = '#56707e';
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
    renderModules(result.data);
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    CresceForteAuth.logout('/login/');
  });
})();
