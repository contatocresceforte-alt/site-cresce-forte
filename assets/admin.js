// assets/admin.js — page logic for /admin/ (Super Admin panel). Requires supabase-js + auth.js loaded first.
(function () {
  var supabase = CresceForteAuth.client;
  var companiesListEl = document.getElementById('companies-list');

  // A API do CRM (apps/api) vive atrás do nginx do front dele (container
  // `web`), que roteia /api/ pro container `api` não importa qual domínio
  // bateu na borda (confirmado ao vivo pela Segurança/CRM, 2026-09-14) —
  // por isso dá pra usar o domínio público crm.cresceforte.com aqui, o
  // mesmo que app.html já usa para o card do CRM, em vez do host direto do
  // EasyPanel (que bypassa o Cloudflare).
  var PLATFORM_API_BASE = 'https://crm.cresceforte.com/api';

  // Prazo do POST que cria empresa. A criação mexe em Auth e banco, então é
  // generosa de propósito: 20 s. O texto diz que a empresa PODE ter sido criada
  // porque cortar o pedido não desfaz o que o servidor já fez — mandar "tente de
  // novo" aqui produziria empresa duplicada e dois convites ao mesmo e-mail.
  var CRIAR_EMPRESA_PRAZO_MS = 20000;
  var MSG_SEM_RESPOSTA = 'O servidor não respondeu a tempo. A empresa PODE ter sido criada: recarregue a página e confira na lista antes de tentar de novo.';

  // Valores reais de companies.status (supabase/migrations/0015_companies.sql
  // no repo do CRM) — sempre maiúsculo, check constraint no banco.
  var STATUS_LABELS = {
    ACTIVE: 'Ativa',
    TRIAL: 'Trial',
    SUSPENDED: 'Suspensa',
    CANCELLED: 'Cancelada',
    INACTIVE: 'Inativa'
  };
  var STATUS_OPTIONS = ['ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED', 'INACTIVE'];

  // Plano do Catálogo (Alain, 26/10): companies.plano_catalogo, migration 0058
  // do CRM. Básico = até 100 produtos, sem vídeo; PRO = até 250, vídeo de até
  // 15 s. Sem meio-termo (Alain, 26/10): toda empresa é Básico ou PRO — as que
  // existiam passaram ao PRO no mesmo dia. '' (null no banco) só sobra se a
  // gravação do plano falhar no cadastro: aparece "Sem plano" e o seletor pede
  // a escolha, mas "Sem plano" não é opção de troca. Quem aplica a regra é o
  // Catálogo (server/planoDaEmpresa.ts); esta tela só grava.
  var PLANO_LABELS = { '': 'Sem plano', BASICO: 'Básico', PRO: 'PRO' };
  var PLANO_OPTIONS = ['BASICO', 'PRO'];
  // false enquanto a coluna não existir no banco (código no ar antes da
  // migration): a lista carrega como antes e a tela não oferece o que não
  // consegue gravar.
  var planosNoBanco = true;

  function formatPlano(plano) {
    return PLANO_LABELS[plano || ''] || plano;
  }

  CresceForteAuth.requireRole('PLATFORM', { loginUrl: '/login/', fallbackUrl: '/app/' }).then(function (session) {
    if (!session) return; // already redirected to /login/ or /app/
    var emailEl = document.getElementById('user-email');
    var name = session.user.user_metadata && session.user.user_metadata.full_name;
    emailEl.textContent = name || session.user.email || '';
    document.getElementById('user-avatar').textContent = iniciais(name || session.user.email || 'Super Admin');
    loadCompanies();
  });

  // ---------------------------------------------------------------------
  // Desenho de 26/10 (pedido do Alain): barra lateral com Clientes e Planos,
  // lista com busca, filtro por plano e páginas de 8. Os dados e as ações são
  // os mesmos de antes; muda só como aparecem. A CSP do Cloudflare
  // (style-src 'self') não aceita style= nem element.style: toda aparência
  // vem de classes em admin-page.css / admin-shell.css.
  // ---------------------------------------------------------------------
  var POR_PAGINA = 8;
  var todasEmpresas = [];
  var pagina = 1;
  // Empresas com os detalhes abertos: sobrevivem ao recarregar a lista (trocar
  // status ou plano recarrega tudo) para o painel não fechar na cara de quem
  // acabou de mexer nele.
  var abertas = {};
  var buscaEl = document.getElementById('busca-empresa');
  var filtroPlanoEl = document.getElementById('filtro-plano');
  var paginacaoEl = document.getElementById('paginacao');
  var paginacaoInfoEl = document.getElementById('paginacao-info');
  var paginacaoBotoesEl = document.getElementById('paginacao-botoes');

  function iniciais(nome) {
    var partes = String(nome || '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    var a = partes[0] ? partes[0][0] : '?';
    var b = partes.length > 1 ? partes[partes.length - 1][0] : (partes[0] && partes[0][1]) || '';
    return (a + b).toUpperCase();
  }
  // Cor do avatar fixa por empresa (o id não muda), em 8 classes de CSS.
  function corDoAvatar(id) {
    var h = 0;
    String(id).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return 'sa-av-' + (h % 8);
  }
  function semAcento(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  buscaEl.addEventListener('input', function () { pagina = 1; renderLista(); });
  filtroPlanoEl.addEventListener('change', function () { pagina = 1; renderLista(); });

  // Seções da barra lateral.
  var secoes = { clientes: document.getElementById('secao-clientes'), planos: document.getElementById('secao-planos') };
  Array.prototype.forEach.call(document.querySelectorAll('.sa-nav-item'), function (botao) {
    botao.addEventListener('click', function () {
      var alvo = botao.getAttribute('data-secao');
      Object.keys(secoes).forEach(function (k) { secoes[k].hidden = k !== alvo; });
      Array.prototype.forEach.call(document.querySelectorAll('.sa-nav-item'), function (b) {
        var ativo = b === botao;
        b.classList.toggle('sa-nav-ativo', ativo);
        if (ativo) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
    });
  });

  function atualizaContagemDePlanos() {
    var conta = { BASICO: 0, PRO: 0 };
    todasEmpresas.forEach(function (c) { if (conta[c.plano_catalogo] !== undefined) conta[c.plano_catalogo] += 1; });
    var frase = function (n) { return n === 1 ? '1 empresa neste plano' : n + ' empresas neste plano'; };
    document.getElementById('conta-basico').textContent = planosNoBanco ? frase(conta.BASICO) : '—';
    document.getElementById('conta-pro').textContent = planosNoBanco ? frase(conta.PRO) : '—';
  }

  function renderLista() {
    var termo = semAcento(buscaEl.value.trim());
    var plano = planosNoBanco ? filtroPlanoEl.value : '';
    var lista = todasEmpresas.filter(function (c) {
      if (plano && c.plano_catalogo !== plano) return false;
      if (!termo) return true;
      return semAcento(c.trade_name).indexOf(termo) >= 0 || semAcento(c.legal_name).indexOf(termo) >= 0;
    });

    companiesListEl.innerHTML = '';
    if (!todasEmpresas.length) {
      companiesListEl.innerHTML = '<p class="cf-loading">Nenhuma empresa cadastrada ainda.</p>';
      paginacaoEl.hidden = true;
      return;
    }
    if (!lista.length) {
      companiesListEl.innerHTML = '<p class="cf-loading">Nenhuma empresa encontrada com esse filtro.</p>';
      paginacaoEl.hidden = true;
      return;
    }

    var paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    if (pagina > paginas) pagina = paginas;
    var inicio = (pagina - 1) * POR_PAGINA;
    var daPagina = lista.slice(inicio, inicio + POR_PAGINA);
    daPagina.forEach(function (company) {
      companiesListEl.appendChild(buildCompanyRow(company));
    });

    paginacaoEl.hidden = false;
    paginacaoInfoEl.textContent = 'Mostrando ' + (inicio + 1) + '\u2013' + (inicio + daPagina.length) + ' de ' + lista.length +
      (lista.length === 1 ? ' cliente' : ' clientes');
    paginacaoBotoesEl.innerHTML = '';
    function botaoPagina(rotulo, alvo, opcoes) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sa-pag-btn' + (opcoes.atual ? ' sa-pag-atual' : '');
      b.textContent = rotulo;
      b.setAttribute('aria-label', opcoes.aria || ('Página ' + alvo));
      if (opcoes.atual) b.setAttribute('aria-current', 'page');
      b.disabled = !!opcoes.desabilitado;
      b.addEventListener('click', function () { pagina = alvo; renderLista(); });
      paginacaoBotoesEl.appendChild(b);
    }
    botaoPagina('\u2039', pagina - 1, { aria: 'Página anterior', desabilitado: pagina === 1 });
    for (var n = 1; n <= paginas; n++) botaoPagina(String(n), n, { atual: n === pagina });
    botaoPagina('\u203a', pagina + 1, { aria: 'Próxima página', desabilitado: pagina === paginas });
  }

  document.getElementById('logout-btn').addEventListener('click', function () {
    CresceForteAuth.logout('/login/');
  });

  function formatStatus(status) {
    return STATUS_LABELS[status] || status || '—';
  }

  async function loadCompanies() {
    companiesListEl.innerHTML = '<p class="cf-loading">Carregando empresas...</p>';

    var result = await supabase
      .from('companies')
      .select('id, legal_name, trade_name, status, plano_catalogo')
      .order('trade_name', { ascending: true });

    // 42703 = coluna inexistente (a migration 0058 ainda não rodou): carrega
    // a lista como antes, sem a parte do plano, em vez de quebrar a tela.
    if (result.error && result.error.code === '42703') {
      planosNoBanco = false;
      result = await supabase
        .from('companies')
        .select('id, legal_name, trade_name, status')
        .order('trade_name', { ascending: true });
    } else if (!result.error) {
      planosNoBanco = true;
    }
    atualizaCampoDePlano();

    if (result.error) {
      console.error('Erro ao carregar empresas:', result.error);
      companiesListEl.innerHTML = '<p class="cf-error-text">Não foi possível carregar as empresas. Tente recarregar a página.</p>';
      return;
    }

    todasEmpresas = result.data || [];
    filtroPlanoEl.parentNode.hidden = !planosNoBanco;
    atualizaContagemDePlanos();
    renderLista();
  }

  function buildCompanyRow(company) {
    var row = document.createElement('div');
    row.className = 'cf-company-row sa-row';
    var nomeEmpresa = company.trade_name || company.legal_name || 'Empresa sem nome';

    // Cabeçalho: a linha inteira é o botão que abre os detalhes.
    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'sa-row-head';

    var avatar = document.createElement('span');
    avatar.className = 'sa-avatar ' + corDoAvatar(company.id);
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = iniciais(nomeEmpresa);
    head.appendChild(avatar);

    var info = document.createElement('span');
    info.className = 'cf-company-info sa-row-info';
    var nameEl = document.createElement('span');
    nameEl.className = 'cf-company-name';
    nameEl.textContent = nomeEmpresa;
    info.appendChild(nameEl);
    var legalEl = document.createElement('span');
    legalEl.className = 'cf-company-legal';
    legalEl.textContent = company.legal_name && company.legal_name !== company.trade_name ? company.legal_name : '\u2014';
    info.appendChild(legalEl);
    head.appendChild(info);

    var pill = document.createElement('span');
    pill.className = 'sa-pill sa-pill-' + String(company.status || 'NONE').toLowerCase();
    pill.textContent = formatStatus(company.status);
    head.appendChild(pill);

    if (planosNoBanco) {
      var planoTxt = document.createElement('span');
      planoTxt.className = 'sa-row-plano';
      if (company.plano_catalogo) {
        planoTxt.appendChild(document.createTextNode('Plano '));
        var forte = document.createElement('strong');
        forte.textContent = formatPlano(company.plano_catalogo);
        planoTxt.appendChild(forte);
      } else {
        planoTxt.textContent = 'Sem plano';
        planoTxt.className += ' sa-row-sem-plano';
      }
      head.appendChild(planoTxt);
    }

    var chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('class', 'sa-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    var seta = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    seta.setAttribute('d', 'm9 6 6 6-6 6');
    chevron.appendChild(seta);
    head.appendChild(chevron);
    row.appendChild(head);

    // Detalhes: status, plano, serviços e usuários (o antigo "Gerenciar").
    var main = document.createElement('div');
    main.className = 'cf-company-main sa-row-controles';

    var statusRow = document.createElement('div');
    statusRow.className = 'cf-status-row';

    var statusRotulo = document.createElement('span');
    statusRotulo.className = 'cf-plano-rotulo';
    statusRotulo.textContent = 'Status';
    statusRow.appendChild(statusRotulo);

    var statusSelect = document.createElement('select');
    statusSelect.className = 'cf-status-select';
    var companyLabel = company.trade_name || company.legal_name || 'empresa sem nome';
    statusSelect.title = 'Alterar status da empresa';
    statusSelect.setAttribute('aria-label', 'Status de ' + companyLabel);
    STATUS_OPTIONS.forEach(function (value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = formatStatus(value);
      if (value === company.status) opt.selected = true;
      statusSelect.appendChild(opt);
    });

    var statusMsg = document.createElement('span');
    statusMsg.className = 'cf-status-msg';
    statusMsg.setAttribute('role', 'status');
    statusMsg.setAttribute('aria-live', 'polite');
    statusMsg.hidden = true;

    statusSelect.addEventListener('change', function () {
      var novoStatus = statusSelect.value;
      var statusAnterior = company.status;

      statusSelect.disabled = true;
      statusMsg.hidden = true;

      supabase
        .from('companies')
        .update({ status: novoStatus })
        .eq('id', company.id)
        .select('id')
        .then(function (result) {
          // .select() força o PostgREST a devolver as linhas afetadas — sem
          // isso, uma RLS que bloqueia o update silenciosamente responde
          // 204/error:null (0 linhas mudadas), e a tela mostraria "salvo"
          // sem ter salvo nada.
          if (result.error || !result.data || !result.data.length) {
            console.error('Erro ao atualizar status da empresa:', result.error || 'nenhuma linha afetada (RLS?)');
            statusSelect.value = statusAnterior;
            statusSelect.disabled = false;
            statusMsg.textContent = 'Erro ao salvar. Tente novamente.';
            statusMsg.className = 'cf-status-msg cf-status-msg-error';
            statusMsg.hidden = false;
            return;
          }
          company.status = novoStatus;
          // Recarrega a lista inteira: é o jeito mais simples de manter o
          // badge, o select e a ordenação (por trade_name) sempre
          // consistentes com o que está no banco.
          loadCompanies();
        });
    });

    statusRow.appendChild(statusSelect);
    statusRow.appendChild(statusMsg);
    main.appendChild(statusRow);

    if (planosNoBanco) main.appendChild(buildPlanoRow(company, companyLabel));

    var detalhes = document.createElement('div');
    detalhes.className = 'sa-row-details';
    detalhes.id = 'detalhes-' + company.id;
    detalhes.hidden = true;
    detalhes.appendChild(main);

    var panel = document.createElement('div');
    panel.className = 'cf-company-services';
    panel.id = 'services-panel-' + company.id;
    panel.setAttribute('aria-live', 'polite');
    detalhes.appendChild(panel);
    row.appendChild(detalhes);

    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-controls', detalhes.id);

    // `loaded` só vira true quando a carga DEU CERTO. Marcando antes, uma falha
    // de rede deixava o painel preso em "Não foi possível carregar os serviços":
    // fechar e reabrir não tentava de novo, e só recarregar a página inteira
    // resolvia. `carregando` evita que dois cliques rápidos disparem duas cargas.
    var loaded = false;
    var carregando = false;
    function abre(mostrar) {
      detalhes.hidden = !mostrar;
      row.classList.toggle('sa-row-aberta', mostrar);
      head.setAttribute('aria-expanded', String(mostrar));
      if (mostrar) abertas[company.id] = true; else delete abertas[company.id];
      if (mostrar && !loaded && !carregando) {
        carregando = true;
        loadServicesForCompany(company.id, panel).then(function (ok) {
          carregando = false;
          loaded = !!ok;
        });
      }
    }
    head.addEventListener('click', function () { abre(detalhes.hidden); });
    if (abertas[company.id]) abre(true);

    return row;
  }

  // Plano do Catálogo da empresa: selo com o plano atual + seletor para trocar
  // (Básico <-> PRO). Mesmo jeito do status: grava direto pelo Supabase
  // (policy upd_companies_platform) e recarrega a lista.
  function buildPlanoRow(company, companyLabel) {
    var planoAtual = company.plano_catalogo || '';

    var row = document.createElement('div');
    row.className = 'cf-status-row cf-plano-row';

    var rotulo = document.createElement('span');
    rotulo.className = 'cf-plano-rotulo';
    rotulo.textContent = 'Plano do catálogo';
    row.appendChild(rotulo);

    var select = document.createElement('select');
    select.className = 'cf-status-select';
    select.title = 'Alterar o plano do catálogo';
    select.setAttribute('aria-label', 'Plano do catálogo de ' + companyLabel);
    if (!planoAtual) {
      // Empresa sem plano: o seletor mostra o pedido de escolha, que não se
      // pode escolher de volta.
      var escolha = document.createElement('option');
      escolha.value = '';
      escolha.textContent = 'Escolha o plano';
      escolha.disabled = true;
      escolha.selected = true;
      select.appendChild(escolha);
    }
    PLANO_OPTIONS.forEach(function (value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = formatPlano(value);
      if (value === planoAtual) opt.selected = true;
      select.appendChild(opt);
    });
    row.appendChild(select);

    var msg = document.createElement('span');
    msg.className = 'cf-status-msg';
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    msg.hidden = true;
    row.appendChild(msg);

    select.addEventListener('change', function () {
      var novo = select.value;
      // O plano decide o que o cliente pode cadastrar (e se a loja mostra
      // vídeo): um clique errado no seletor não pode valer sem confirmação.
      var aviso = 'Mudar o plano do catálogo de ' + companyLabel + ' de "' + formatPlano(planoAtual) +
        '" para "' + formatPlano(novo) + '"?';
      if (novo === 'BASICO') {
        aviso += '\n\nNo Básico: até 100 produtos e sem vídeos (os vídeos já cadastrados saem da loja, mas ficam guardados).' +
          '\nSe a loja tiver mais de 100 produtos, os primeiros 100 cadastrados continuam na loja; os outros ficam salvos, ' +
          'bloqueados (em cinza) e fora da loja até ela excluir produtos ou voltar ao PRO.';
      }
      if (novo === 'PRO') aviso += '\n\nNo PRO: até 250 produtos e vídeos de até 15 segundos.';
      if (!window.confirm(aviso)) {
        select.value = planoAtual;
        return;
      }

      select.disabled = true;
      msg.hidden = true;
      supabase
        .from('companies')
        .update({ plano_catalogo: novo || null })
        .eq('id', company.id)
        .select('id, plano_catalogo')
        .then(function (result) {
          // Mesma razão do status: sem linha devolvida, a RLS barrou em silêncio.
          if (result.error || !result.data || !result.data.length) {
            console.error('Erro ao atualizar o plano da empresa:', result.error || 'nenhuma linha afetada (RLS?)');
            select.value = planoAtual;
            select.disabled = false;
            msg.textContent = 'Erro ao salvar. Tente novamente.';
            msg.className = 'cf-status-msg cf-status-msg-error';
            msg.hidden = false;
            return;
          }
          company.plano_catalogo = result.data[0].plano_catalogo;
          loadCompanies();
        });
    });

    return row;
  }

  async function loadServicesForCompany(companyId, panel) {
    panel.innerHTML = '<p class="cf-loading">Carregando serviços...</p>';

    var servicesResult = await supabase
      .from('services')
      .select('id, key, name')
      .order('name', { ascending: true });

    if (servicesResult.error) {
      console.error('Erro ao carregar catálogo de serviços:', servicesResult.error);
      panel.innerHTML = '<p class="cf-error-text">Não foi possível carregar os serviços. Feche e abra de novo para tentar outra vez.</p>';
      return false;
    }

    var companyServicesResult = await supabase
      .from('company_services')
      .select('service_id, active')
      .eq('company_id', companyId);

    if (companyServicesResult.error) {
      console.error('Erro ao carregar serviços da empresa:', companyServicesResult.error);
      panel.innerHTML = '<p class="cf-error-text">Não foi possível carregar os serviços contratados. Feche e abra de novo para tentar outra vez.</p>';
      return false;
    }

    var activeMap = {};
    (companyServicesResult.data || []).forEach(function (row) {
      activeMap[row.service_id] = !!row.active;
    });

    var services = servicesResult.data || [];
    panel.innerHTML = '';
    if (services.length === 0) {
      panel.innerHTML = '<p class="cf-loading">Nenhum serviço no catálogo ainda.</p>';
      return true;
    }

    services.forEach(function (service) {
      panel.appendChild(buildServiceToggleRow(companyId, service, !!activeMap[service.id]));
    });
    // Usuários da empresa (Super Admin, 27/09) — módulo próprio, admin-usuarios.js.
    if (window.CresceForteAdminUsuarios) window.CresceForteAdminUsuarios.montar(companyId, panel);
    return true;
  }

  function buildServiceToggleRow(companyId, service, isActive) {
    var row = document.createElement('div');
    row.className = 'cf-service-row';

    var nameEl = document.createElement('span');
    nameEl.className = 'cf-service-name';
    nameEl.textContent = service.name;
    row.appendChild(nameEl);

    var msgEl = document.createElement('span');
    msgEl.className = 'cf-service-msg';
    msgEl.setAttribute('role', 'status');
    msgEl.setAttribute('aria-live', 'polite');
    msgEl.hidden = true;

    var toggle = document.createElement('label');
    toggle.className = 'cf-toggle';

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = isActive;
    input.setAttribute('aria-label', 'Ativar ' + service.name);

    var track = document.createElement('span');
    track.className = 'cf-toggle-track';
    var thumb = document.createElement('span');
    thumb.className = 'cf-toggle-thumb';
    track.appendChild(thumb);

    toggle.appendChild(input);
    toggle.appendChild(track);

    input.addEventListener('change', function () {
      var nextActive = input.checked;
      var previousActive = !nextActive;

      input.disabled = true;
      toggle.classList.add('cf-toggle-loading');
      msgEl.hidden = true;

      var payload = {
        company_id: companyId,
        service_id: service.id,
        active: nextActive
      };
      // activated_at records the last time the service was turned ON; leave it
      // untouched when deactivating so the activation history is preserved.
      if (nextActive) {
        payload.activated_at = new Date().toISOString();
      }

      supabase
        .from('company_services')
        .upsert(payload, { onConflict: 'company_id,service_id' })
        .select('service_id')
        .then(function (result) {
          input.disabled = false;
          toggle.classList.remove('cf-toggle-loading');

          // Mesma razão do update de status: sem .select(), RLS bloqueando
          // em silêncio pareceria sucesso (204/error:null, 0 linhas).
          if (result.error || !result.data || !result.data.length) {
            console.error('Erro ao atualizar serviço:', result.error || 'nenhuma linha afetada (RLS?)');
            input.checked = previousActive;
            msgEl.textContent = 'Erro ao salvar. Tente novamente.';
            msgEl.className = 'cf-service-msg cf-service-msg-error';
            msgEl.hidden = false;
            return;
          }

          msgEl.textContent = 'Salvo.';
          msgEl.className = 'cf-service-msg cf-service-msg-ok';
          msgEl.hidden = false;
          setTimeout(function () { msgEl.hidden = true; }, 2500);
        });
    });

    row.appendChild(toggle);
    row.appendChild(msgEl);
    return row;
  }

  // ---------------------------------------------------------------------
  // Nova empresa — a única ação desta tela que NÃO fala direto com o
  // Supabase: criar um usuário no Supabase Auth exige a service_role key,
  // que uma página estática nunca pode guardar. Por isso isto chama a rota
  // nova do backend do CRM (POST /api/plataforma/empresas), passando o
  // access_token da sessão atual — mesmo padrão de apps/web/src/lib/apiV1.js
  // no repo do CRM.
  // ---------------------------------------------------------------------
  var newCompanyToggle = document.getElementById('new-company-toggle');
  var newCompanyForm = document.getElementById('new-company-form');
  var newCompanyCancel = document.getElementById('new-company-cancel');
  var newCompanySubmit = document.getElementById('new-company-submit');
  var newCompanyMsg = document.getElementById('new-company-msg');

  var ncFields = {
    legalName: document.getElementById('nc-legal-name'),
    tradeName: document.getElementById('nc-trade-name'),
    document: document.getElementById('nc-document'),
    email: document.getElementById('nc-email'),
    phone: document.getElementById('nc-phone'),
    adminNome: document.getElementById('nc-admin-nome'),
    adminEmail: document.getElementById('nc-admin-email'),
    plano: document.getElementById('nc-plano')
  };
  var ncPlanoCampo = document.getElementById('nc-plano-campo');

  // Sem a coluna no banco (ver planosNoBanco) o campo some e deixa de ser
  // obrigatório: a empresa continua sendo criada como antes, neutra.
  function atualizaCampoDePlano() {
    if (!ncFields || !ncFields.plano || !ncPlanoCampo) return;
    ncPlanoCampo.hidden = !planosNoBanco;
    ncFields.plano.required = planosNoBanco;
  }

  // O plano não vai no POST da API do CRM (ela não conhece planos): depois que
  // a empresa existe, grava direto, como a troca de plano da lista. Devolve
  // true/false, nunca lança — a empresa já foi criada e a senha temporária
  // tem de aparecer de qualquer jeito.
  //
  // Prazo próprio (8 s): sem ele, um update que trava sem falhar segurava a
  // mensagem com a senha para sempre — e a senha não aparece de novo.
  var GRAVAR_PLANO_PRAZO_MS = 8000;
  function gravaPlanoDaNovaEmpresa(empresaId, plano) {
    if (!plano) return Promise.resolve(true);
    // Plano escolhido e resposta sem o id da empresa (resposta cortada): não
    // dá para gravar, e dizer "salvo" deixaria a empresa sem limite calada.
    if (!empresaId) return Promise.resolve(false);
    var gravacao = supabase
      .from('companies')
      .update({ plano_catalogo: plano })
      .eq('id', empresaId)
      .select('id')
      .then(function (result) {
        if (result.error || !result.data || !result.data.length) {
          console.error('Empresa criada, plano não gravado:', result.error || 'nenhuma linha afetada (RLS?)');
          return false;
        }
        return true;
      }, function (erro) {
        console.error('Empresa criada, plano não gravado:', erro);
        return false;
      });
    var prazo = new Promise(function (ok) {
      setTimeout(function () { ok(false); }, GRAVAR_PLANO_PRAZO_MS);
    });
    return Promise.race([gravacao, prazo]);
  }

  function setNewCompanyFormOpen(open) {
    newCompanyForm.hidden = !open;
    newCompanyToggle.hidden = open;
    if (open) {
      ncFields.legalName.focus();
    } else {
      newCompanyForm.reset();
      newCompanyMsg.hidden = true;
      newCompanyToggle.focus();
    }
  }

  newCompanyToggle.addEventListener('click', function () { setNewCompanyFormOpen(true); });
  newCompanyCancel.addEventListener('click', function () { setNewCompanyFormOpen(false); });

  function showNewCompanyMsg(text, ok, senha) {
    newCompanyMsg.className = 'cf-form-msg ' + (ok ? 'cf-form-msg-ok' : 'cf-form-msg-error');
    newCompanyMsg.innerHTML = '';
    newCompanyMsg.appendChild(document.createTextNode(text));

    if (senha) {
      var wrap = document.createElement('span');
      wrap.className = 'cf-inline-pwd';

      var valueEl = document.createElement('span');
      valueEl.className = 'cf-inline-pwd-value';

      function render(revealed) { valueEl.textContent = revealed ? senha : '••••••••••'; }
      render(false);

      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'cf-reveal-btn';
      toggle.setAttribute('aria-label', 'Mostrar senha temporária');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + CresceForteAuth.EYE_OPEN + '</svg>';
      CresceForteAuth.wireEyeToggle(toggle, render, { show: 'Mostrar senha temporária', hide: 'Esconder senha temporária' });

      wrap.appendChild(valueEl);
      wrap.appendChild(toggle);
      newCompanyMsg.appendChild(wrap);
    }

    newCompanyMsg.hidden = false;
  }

  newCompanyForm.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!newCompanyForm.checkValidity()) {
      newCompanyForm.reportValidity();
      showNewCompanyMsg('Preencha os campos obrigatórios (marcados com *) antes de criar a empresa.', false);
      return;
    }

    var payload = {
      legalName: ncFields.legalName.value.trim(),
      tradeName: ncFields.tradeName.value.trim() || undefined,
      document: ncFields.document.value.trim() || undefined,
      email: ncFields.email.value.trim() || undefined,
      phone: ncFields.phone.value.trim() || undefined,
      adminNome: ncFields.adminNome.value.trim(),
      adminEmail: ncFields.adminEmail.value.trim()
    };
    // Remove os campos opcionais vazios em vez de mandar string vazia —
    // a rota trata undefined como "não informado" (zod .optional()).
    Object.keys(payload).forEach(function (key) {
      if (payload[key] === undefined) delete payload[key];
    });
    // Lido AGORA: o form.reset() do sucesso apaga o campo antes da gravação.
    var planoEscolhido = planosNoBanco && ncFields.plano ? ncFields.plano.value : '';

    newCompanySubmit.disabled = true;
    newCompanyCancel.disabled = true;
    newCompanyMsg.hidden = true;

    // Sem prazo, um pedido que nunca responde deixava os DOIS botões
    // desabilitados para sempre e nenhuma mensagem na tela: nem criar de novo,
    // nem cancelar, só recarregar a página — e sem saber o que aconteceu. O
    // prazo existe com ou sem AbortController (com ele o pedido também é
    // cortado); o `venceu` é uma corrida, não um substituto da resposta.
    var controller = window.AbortController ? new window.AbortController() : null;
    // O que decide a mensagem NÃO é o nome do erro, é "o pedido pode ter chegado
    // ao servidor?". Prazo estourado e queda de rede compartilham isso: em
    // qualquer um dos dois o servidor pode ter criado a empresa, o usuário no
    // Auth e mandado o convite, e a resposta é que se perdeu. Só prova que nada
    // aconteceu o erro levantado ANTES de o pedido partir, ou uma RESPOSTA do
    // servidor (aí ele decidiu, e a resposta diz o quê). Achado da Esther: com a
    // checagem por `AbortError`, `TypeError: Failed to fetch` caía na moldura
    // otimista e o admin clicava de novo, criando a duplicata.
    var pedidoPartiu = false;
    var houveResposta = false;
    var venceu;
    var prazo = new Promise(function (r) { venceu = r; });
    var prazoId = setTimeout(function () {
      if (controller) { controller.abort(); }
      venceu();
    }, CRIAR_EMPRESA_PRAZO_MS);

    supabase.auth.getSession()
      .then(function (sessionResult) {
        var token = sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
        if (!token) throw new Error('Sessão expirada. Recarregue a página e faça login novamente.');

        pedidoPartiu = true;
        return Promise.race([
          prazo.then(function () { throw new Error(MSG_SEM_RESPOSTA); }),
          fetch(PLATFORM_API_BASE + '/plataforma/empresas', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(payload),
            signal: controller ? controller.signal : undefined
          })
        ]);
      })
      .then(function (res) {
        houveResposta = true;
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) {
            var mensagem = (body.erro && body.erro.mensagem) || ('Falha ao criar empresa (HTTP ' + res.status + ').');
            throw new Error(mensagem);
          }
          return body.dados;
        });
      })
      .then(function (dados) {
        var empresaId = dados && dados.empresa && dados.empresa.id;
        return gravaPlanoDaNovaEmpresa(empresaId, planoEscolhido).then(function (planoGravado) {
          return { dados: dados, planoGravado: planoGravado };
        });
      })
      .then(function (r) {
        var senha = r.dados && r.dados.senhaTemporaria;
        // A empresa existe nos dois casos; só muda o recado. Se o plano não
        // gravou, ela ficou "Sem plano" (sem limites) até alguém escolher na
        // lista — e a senha aparece igual, porque não há como vê-la de novo.
        var texto = r.planoGravado
          ? (senha
            ? 'Empresa criada. Senha temporária do administrador — copie agora, ela não aparece de novo:'
            : 'Empresa criada com sucesso.')
          : 'Empresa criada, mas o plano do catálogo NÃO foi salvo: escolha o plano na lista de empresas abaixo.' +
            (senha ? ' Senha temporária do administrador — copie agora, ela não aparece de novo:' : '');
        showNewCompanyMsg(texto, r.planoGravado, senha);
        // form.reset() só afeta os controles (input/select), não o <p> da
        // mensagem — limpa os campos sem esconder o aviso da senha. Sem
        // isso, clicar "Criar empresa" de novo por engano reenviaria os
        // mesmos dados e criaria uma empresa duplicada.
        newCompanyForm.reset();
        loadCompanies();
      })
      .catch(function (erro) {
        console.error('Erro ao criar empresa:', erro);
        var semResposta = pedidoPartiu && !houveResposta;
        showNewCompanyMsg(semResposta ? MSG_SEM_RESPOSTA : (erro.message || 'Não foi possível criar a empresa.'), false);
      })
      .finally(function () {
        clearTimeout(prazoId);
        newCompanySubmit.disabled = false;
        newCompanyCancel.disabled = false;
      });
  });
})();
