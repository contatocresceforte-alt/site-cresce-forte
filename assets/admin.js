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

  CresceForteAuth.requireRole('PLATFORM', { loginUrl: '/login/', fallbackUrl: '/app/' }).then(function (session) {
    if (!session) return; // already redirected to /login/ or /app/
    var emailEl = document.getElementById('user-email');
    var name = session.user.user_metadata && session.user.user_metadata.full_name;
    emailEl.textContent = name || session.user.email || '';
    loadCompanies();
  });

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
      .select('id, legal_name, trade_name, status')
      .order('trade_name', { ascending: true });

    if (result.error) {
      console.error('Erro ao carregar empresas:', result.error);
      companiesListEl.innerHTML = '<p class="cf-error-text">Não foi possível carregar as empresas. Tente recarregar a página.</p>';
      return;
    }

    var companies = result.data || [];
    if (companies.length === 0) {
      companiesListEl.innerHTML = '<p class="cf-loading">Nenhuma empresa cadastrada ainda.</p>';
      return;
    }

    companiesListEl.innerHTML = '';
    companies.forEach(function (company) {
      companiesListEl.appendChild(buildCompanyRow(company));
    });
  }

  function buildCompanyRow(company) {
    var row = document.createElement('div');
    row.className = 'cf-company-row';

    var main = document.createElement('div');
    main.className = 'cf-company-main';

    var info = document.createElement('div');
    info.className = 'cf-company-info';

    var nameEl = document.createElement('span');
    nameEl.className = 'cf-company-name';
    nameEl.textContent = company.trade_name || company.legal_name || 'Empresa sem nome';
    info.appendChild(nameEl);

    if (company.legal_name && company.legal_name !== company.trade_name) {
      var legalEl = document.createElement('span');
      legalEl.className = 'cf-company-legal';
      legalEl.textContent = company.legal_name;
      info.appendChild(legalEl);
    }
    main.appendChild(info);

    var statusRow = document.createElement('div');
    statusRow.className = 'cf-status-row';

    var statusEl = document.createElement('span');
    statusEl.className = 'cf-status-badge';
    if (company.status && company.status !== 'ACTIVE') {
      statusEl.className += ' cf-status-muted';
    }
    statusEl.textContent = formatStatus(company.status);
    statusRow.appendChild(statusEl);

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

    var manageBtn = document.createElement('button');
    manageBtn.type = 'button';
    manageBtn.className = 'cf-manage-btn';
    manageBtn.textContent = 'Gerenciar';
    manageBtn.setAttribute('aria-expanded', 'false');
    main.appendChild(manageBtn);

    row.appendChild(main);

    var panel = document.createElement('div');
    panel.className = 'cf-company-services';
    panel.id = 'services-panel-' + company.id;
    panel.setAttribute('aria-live', 'polite');
    panel.hidden = true;
    manageBtn.setAttribute('aria-controls', panel.id);
    row.appendChild(panel);

    // `loaded` só vira true quando a carga DEU CERTO. Marcando antes, uma falha
    // de rede deixava o painel preso em "Não foi possível carregar os serviços":
    // fechar e reabrir não tentava de novo, e só recarregar a página inteira
    // resolvia. `carregando` evita que dois cliques rápidos disparem duas cargas.
    var loaded = false;
    var carregando = false;
    manageBtn.addEventListener('click', function () {
      var willShow = panel.hidden;
      panel.hidden = !willShow;
      manageBtn.textContent = willShow ? 'Fechar' : 'Gerenciar';
      manageBtn.setAttribute('aria-expanded', String(willShow));
      if (willShow && !loaded && !carregando) {
        carregando = true;
        loadServicesForCompany(company.id, panel).then(function (ok) {
          carregando = false;
          loaded = !!ok;
        });
      }
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
    adminEmail: document.getElementById('nc-admin-email')
  };

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
        var senha = dados && dados.senhaTemporaria;
        showNewCompanyMsg(
          senha
            ? 'Empresa criada. Senha temporária do administrador — copie agora, ela não aparece de novo:'
            : 'Empresa criada com sucesso.',
          true,
          senha
        );
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
