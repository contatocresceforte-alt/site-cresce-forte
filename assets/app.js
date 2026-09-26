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
    crm: { url: 'https://crm.cresceforte.com/', ticketUrl: 'https://crm.cresceforte.com/api/auth/portal-ticket', titulo: 'Relacione-se com seus clientes.', desc: 'Converse com seus clientes, organize seu funil de vendas e gerencie seu relacionamento de forma simples e eficiente.', icone: 'i-crm' },
    catalogo: { url: 'https://catalogo.cresceforte.com/', ticketUrl: 'https://catalogo.cresceforte.com/catalog-editor-api/portal-ticket', titulo: 'Monte e publique seu catálogo digital.', desc: 'Apresente seus produtos de forma profissional e aumente suas vendas com um catálogo moderno e completo.', icone: 'i-catalogo' }
  };

  // Ícone do sprite de /app/index.html. `i-modulo` é o genérico de quem entrar
  // em company_services sem estar no MODULE_INFO — o cartão aparece do mesmo
  // jeito, só não abre.
  function icone(nome, classe) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', classe || 'cf-ico');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + nome);
    svg.appendChild(use);
    return svg;
  }

  var RESEND_MS = 250;
  var HANDSHAKE_MS = 10000;
  // Os dois textos dizem O QUE FAZER, porque depois que o login nativo dos
  // módulos sair não existe caminho alternativo por aqui: quem não consegue
  // abrir pelo portal só resolve trocando de navegador ou liberando o pop-up.
  // "Outro app" cobre o navegador embutido (WhatsApp, Instagram, Facebook), que
  // muitas vezes não devolve a aba de window.open e por isso cai no primeiro.
  var MSG_BLOCKED = 'Seu navegador bloqueou a nova aba. Permita pop-ups para este site e clique de novo. Se você está dentro de outro aplicativo, como WhatsApp ou Instagram, abra este painel no Chrome ou no Safari.';
  var MSG_HANDSHAKE = 'Não foi possível abrir pelo portal. Feche a aba que abriu, volte aqui e clique de novo. Se continuar, abra este painel no Chrome ou no Safari.';

  // Prazos por clique (proposta portal-emissao-erro-v1, aprovada pela Esther).
  // O módulo espera a mensagem por 10 s A PARTIR DE QUANDO ELE CARREGA (1 a 2 s
  // depois do clique), então o hub precisa começar a entregar até uns 7 a 8 s
  // depois do clique. A renovação (só quando o token está velho) usa até 3 s; a
  // emissão usa o que sobrar do prazo, entre 3 s e 6 s.
  var TOKEN_MAX_AGE_S = 240;   // o servidor aceita 300 s (iat); sobram 60 s de margem
  var REFRESH_MS = 3000;
  var DEADLINE_MS = 8000;
  var EMIT_MIN_MS = 3000;
  var EMIT_MAX_MS = 6000;

  // Códigos que o servidor de emissão pode devolver (conjunto fechado do
  // contrato). Qualquer outro valor é tratado como "sem código".
  var CODIGOS = { sem_perfil: 1, sessao_invalida: 1, limite: 1, indisponivel: 1, erro_interno: 1 };
  var RE_CORRELACAO = /^[0-9a-f]{8}$/;

  // Token vivo em memória. Começa com o da sessão validada e é regravado por
  // toda renovação que TERMINA (mesmo depois do prazo do clique) e pelo
  // onAuthStateChange, para os cliques seguintes não usarem um token envelhecido.
  // A persistência da sessão continua sendo do supabase-js.
  var vivo = null;

  // Conta os cliques em cartão, para um clique lento não escrever na tela depois
  // de um clique mais novo (ver openModule).
  var cliqueAtual = 0;

  // Idade do token em segundos, lida do iat só para decidir se renova. O servidor
  // continua sendo a única autoridade sobre validade, e nada além da decisão de
  // tempo sai destas claims. Ilegível, malformado ou sem iat numérico conta como
  // "muito velho": enviesado para renovar, nunca para usar.
  // navigator.onLine mente quando diz "true" (pode haver rede sem internet), mas
  // "false" é confiável: o sistema operacional não vê interface nenhuma.
  function semRede() {
    return typeof navigator === 'object' && navigator && navigator.onLine === false;
  }

  function idadeDoToken(token) {
    try {
      var parte = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var iat = JSON.parse(atob(parte)).iat;
      if (typeof iat !== 'number' || !isFinite(iat)) { return Infinity; }
      var idade = Date.now() / 1000 - iat;
      // iat no futuro quer dizer relógio do cliente atrasado (ou token estranho).
      // Tratar como idade 0 seria o único ponto enviesado para USAR: uma máquina
      // atrasada nunca renovaria por conta própria. Vale a mesma regra do resto:
      // na dúvida, renova. Tolerância de 60 s cobre o desencontro normal.
      if (idade < -60) { return Infinity; }
      return Math.max(0, idade);
    } catch (e) { return Infinity; }
  }

  // Renova a sessão com teto de REFRESH_MS. Devolve o token novo, ou null se a
  // renovação falhou ou não terminou no prazo. NUNCA devolve o token velho: o hub
  // não manda de propósito um token que já sabe vencido. Se ela terminar depois do
  // prazo, o token novo ainda é gravado em `vivo` para o próximo clique.
  function renovar() {
    var id = null;
    var refresh = CresceForteAuth.client.auth.refreshSession().then(function (r) {
      var t = r && r.data && r.data.session ? r.data.session.access_token : null;
      if (t) { vivo = t; }
      return t;
    }).catch(function () { return null; });
    var prazo = new Promise(function (resolve) { id = setTimeout(function () { resolve(null); }, REFRESH_MS); });
    // Cancela o prazo quando a renovação chega antes, para não deixar um
    // temporizador solto por clique.
    return Promise.race([refresh, prazo]).then(function (t) { if (id) { clearTimeout(id); } return t; });
  }

  // Token que serve para pedir o ticket agora: o vivo, se recente; senão renova.
  function tokenParaEmitir() {
    if (vivo && idadeDoToken(vivo) <= TOKEN_MAX_AGE_S) { return Promise.resolve(vivo); }
    return renovar();
  }

  // Lê o corpo de erro da emissão. codigo e correlacao são campos irmãos de
  // `erro`/`error` (o texto humano, que o hub ignora). O handler global do CRM
  // manda erro.codigo como objeto: aceito como segunda chance. Nada do corpo vai
  // para innerHTML, log ou URL.
  function classificarRecusa(status, body) {
    var codigo = null;
    if (body && typeof body === 'object') {
      var c = typeof body.codigo === 'string' ? body.codigo :
        (body.erro && typeof body.erro === 'object' && typeof body.erro.codigo === 'string' ? body.erro.codigo : null);
      if (c && CODIGOS[c] === 1) { codigo = c; }
    }
    var correlacao = body && typeof body === 'object' && typeof body.correlacao === 'string' && RE_CORRELACAO.test(body.correlacao) ? body.correlacao : null;
    var motivo = 'generico';
    if (codigo === 'sem_perfil') { motivo = 'sem_perfil'; }
    else if (codigo === 'sessao_invalida' || (codigo === null && status === 401)) { motivo = 'sessao_invalida'; }
    else if (codigo === 'limite' || status === 429) { motivo = 'limite'; }
    return { ok: false, motivo: motivo, correlacao: correlacao };
  }

  // Um pedido de emissão. Sempre resolve (nunca rejeita) com {ok:true, ticket} ou
  // {ok:false, motivo, correlacao}. O motivo 'tempo' (nosso abort) é distinto de
  // 'rede' (sem resposta): o suporte precisa saber quem cortou.
  function emitir(info, token, inicio) {
    var restante = DEADLINE_MS - (Date.now() - inicio);
    var ms = Math.max(EMIT_MIN_MS, Math.min(EMIT_MAX_MS, restante));
    var controller = window.AbortController ? new window.AbortController() : null;
    // O prazo vale COM ou SEM AbortController. Sem ele o fetch continua correndo
    // (pode virar ticket órfão, como o abort também pode), mas a aba recebe
    // 'tempo' e nunca fica sem resposta nenhuma — que era o caso quando o prazo
    // só existia se o AbortController existisse.
    var venceu;
    var prazo = new Promise(function (r) { venceu = r; });
    var timeoutId = setTimeout(function () {
      if (controller) { controller.abort(); }
      venceu({ ok: false, motivo: 'tempo', correlacao: null });
    }, ms);
    function fim(r) { clearTimeout(timeoutId); return r; }
    function falhou(err) { return fim({ ok: false, motivo: err && err.name === 'AbortError' ? 'tempo' : 'rede', correlacao: null }); }
    return Promise.race([prazo, fetch(info.ticketUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (res.ok) {
        // Corpo ilegível num 2xx é problema do servidor, não da rede: o servidor
        // respondeu. Cai no genérico, como qualquer 2xx sem ticket.
        return res.json().then(function (d) { return d; }, function () { return null; }).then(function (d) {
          return fim(d && typeof d.ticket === 'string' && d.ticket ? { ok: true, ticket: d.ticket } : { ok: false, motivo: 'generico', correlacao: null });
        });
      }
      return res.json().then(function (b) { return b; }, function () { return null; }).then(function (b) {
        return fim(classificarRecusa(res.status, b));
      });
    }, falhou)]);
  }

  // Texto da tela para cada motivo. Sempre texto FIXO do hub: nunca a mensagem do
  // servidor. `nome` é o nome do cartão (vem do banco) e entra só por textContent.
  function mensagemDaRecusa(r, nome) {
    switch (r.motivo) {
      case 'sem_perfil': return 'Sua conta não tem acesso ao ' + nome + '. Fale com quem administra a sua empresa na Cresce Forte.';
      // 'sessao_invalida' como apelido de 'sessao': hoje o openModule sempre
      // converte antes de chegar aqui, mas se alguém mexer na lógica de repetição
      // o motivo cairia no default e mostraria mensagem genérica COM código de
      // correlação para um problema de sessão.
      case 'sessao_invalida':
      case 'sessao': return 'Não consegui confirmar a sua sessão. Tente de novo; se continuar, saia e entre de novo no portal.';
      case 'limite': return 'Muitas tentativas seguidas. Espere um minuto e clique de novo.';
      case 'tempo': return 'O servidor demorou para responder. Tente de novo.';
      // Não diz "sem conexão": um fetch bloqueado por CORS falha igual a falta de internet.
      case 'rede': return 'Não consegui falar com o servidor. Confira a internet e tente de novo; se continuar, avise o suporte.';
      default: return 'Não foi possível abrir o ' + nome + ' agora. Tente de novo em instantes. Se continuar, avise o suporte' +
        (r.correlacao ? ' informando o código: ' + r.correlacao : '') + '.';
    }
  }

  // Erro na própria página do hub: a aba do módulo já está em outra origem e
  // não dá pra escrever nela.
  function limparErroDoHub() {
    var box = document.getElementById('portal-error');
    if (box && box.parentNode) { box.parentNode.removeChild(box); }
  }

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

  function openModule(info, nome) {
    // O erro do clique anterior não pode ficar na tela depois de um clique novo:
    // uma mensagem velha ao lado de um sucesso faz diagnosticar o incidente errado.
    limparErroDoHub();
    if (!info.ticketUrl || !vivo) { window.open(info.url, '_blank', 'noopener'); return; }
    // Dois cliques seguidos correm em paralelo e dividem a MESMA caixa de erro.
    // Sem isto, um clique lento que falha depois de um clique novo escreve a
    // mensagem dele por cima, e a tela passa a mostrar o erro da tentativa errada
    // (ou um erro ao lado de um módulo que abriu). Só o clique mais recente pode
    // escrever na tela; a entrega à aba de cada clique continua normal, porque
    // cada uma tem a sua própria aba.
    var meu = ++cliqueAtual;
    function meuErro(msg) { if (meu === cliqueAtual) { showHubError(msg); } }
    var inicio = Date.now();
    var origin = new URL(info.url).origin;
    // Abre a aba já na hora do clique (gesto síncrono do usuário) — window.open()
    // chamado só depois do fetch resolver (assíncrono) é bloqueado por popup
    // blocker em navegador de verdade. 'noopener' aqui faria window.open()
    // retornar null (spec atual) e perderíamos a referência que o postMessage
    // precisa; abre sem a feature e zera .opener manualmente (o módulo não
    // alcança o hub, a referência hub→aba continua).
    var tab = window.open(info.url + '#portal', '_blank');
    if (!tab) { meuErro(MSG_BLOCKED); return; }
    // Alguns motores podem lançar SecurityError aqui; sem o try/catch a função
    // abortaria antes de entregar o ticket. O hub segue mesmo assim.
    try { tab.opener = null; } catch (e) { /* segue para a entrega */ }

    tokenParaEmitir()
      .then(function (token) {
        // Renovação que não completou: NÃO emite. Nunca manda de propósito um
        // token que já se sabe vencido.
        // Sem internet, a renovação falha e "saia e entre de novo no portal"
        // seria conselho errado: a sessão pode estar ótima. navigator.onLine só é
        // confiável quando diz que NÃO há rede, e é exatamente esse o uso aqui.
        if (!token) { return { ok: false, motivo: semRede() ? 'rede' : 'sessao', correlacao: null }; }
        return emitir(info, token, inicio).then(function (r) {
          if (r.ok || r.motivo !== 'sessao_invalida') { return r; }
          // Só repete se AINDA CABE no prazo: renovar de novo (até REFRESH_MS) mais
          // uma emissão (piso de EMIT_MIN_MS). Sem esta conta, a repetição podia
          // terminar por volta de 15 s, depois de o módulo já ter desistido aos 10 s:
          // a pessoa veria "não foi possível abrir pelo portal" em vez do motivo
          // real, e sobraria um ticket órfão.
          if (DEADLINE_MS - (Date.now() - inicio) < REFRESH_MS + EMIT_MIN_MS) {
            return { ok: false, motivo: 'sessao', correlacao: null };
          }
          // Uma repetição só, e só no 401, e só se a renovação produzir um token
          // GENUINAMENTE novo (corrida real: o token venceu entre a checagem e a
          // emissão). Renovação que falhou ou devolveu o mesmo token: falha direto.
          return renovar().then(function (novo) {
            if (!novo || novo === token) { return { ok: false, motivo: 'sessao', correlacao: null }; }
            return emitir(info, novo, inicio).then(function (r2) {
              return r2.ok || r2.motivo !== 'sessao_invalida' ? r2 : { ok: false, motivo: 'sessao', correlacao: null };
            });
          });
        });
      })
      .catch(function () { return { ok: false, motivo: 'generico', correlacao: null }; })
      .then(function (r) {
        if (r.ok) {
          // O ticket só existe dentro desta closure; nada de log dele nem da mensagem.
          deliver(tab, origin, { type: 'cf-portal-ticket', v: 1, ticket: r.ticket }, function () { meuErro(MSG_HANDSHAKE); });
        } else {
          // Contrato v1 intacto: em qualquer recusa a aba já aberta recebe
          // cf-portal-fail. O aviso à aba vem ANTES de mexer na tela: se a
          // montagem da mensagem lançasse, a aba ficaria sem ticket e sem fail,
          // que é o único jeito de quebrar o contrato a partir daqui.
          deliver(tab, origin, { type: 'cf-portal-fail', v: 1 });
          meuErro(mensagemDaRecusa(r, nome));
        }
      })
      // Só alcança isto se escrever na tela falhar (o #modules-area sumiu do
      // DOM). A obrigação com a aba já foi cumprida acima; aqui não há nada a
      // fazer além de não deixar virar rejeição não tratada.
      .catch(function () {});
  }

  function renderModules(rows) {
    var area = document.getElementById('modules-area');
    var trilho = document.getElementById('rail-modules');
    var rotuloTrilho = document.getElementById('rail-modules-label');
    var rotuloSecao = document.getElementById('section-label');
    area.innerHTML = '';
    trilho.innerHTML = '';
    if (!rows || !rows.length) {
      rotuloTrilho.hidden = true;
      rotuloSecao.hidden = true;
      area.innerHTML = '<div class="cf-placeholder"><span class="cf-tag">Nenhum módulo</span><h2>Nenhum serviço ativo</h2><p>Fale com o suporte da Cresce Forte para ativar um módulo para sua empresa.</p></div>';
      return;
    }
    rotuloTrilho.hidden = false;
    rotuloSecao.hidden = false;
    rows.forEach(function (row) {
      var svc = row.services;
      var info = MODULE_INFO[svc.key] || {};

      // Item do trilho. É BOTÃO e passa pelo mesmo openModule, nunca um <a
      // href> para o módulo: link direto abriria a outra ponta SEM ticket, que
      // é exatamente o segundo login que o portal existe para evitar.
      if (info.url) {
        var itemTrilho = document.createElement('button');
        itemTrilho.type = 'button';
        itemTrilho.className = 'cf-rail-item';
        itemTrilho.appendChild(icone(info.icone || 'i-modulo'));
        itemTrilho.appendChild(document.createTextNode(svc.name));
        itemTrilho.appendChild(icone('i-abrir', 'cf-ico cf-ext'));
        itemTrilho.addEventListener('click', function () {
          document.getElementById('app').classList.remove('rail-open');
          openModule(info, svc.name);
        });
        trilho.appendChild(itemTrilho);
      }

      // O cartão inteiro continua sendo o botão (clicar em qualquer ponto abre),
      // e o "Acessar …" é só o desenho do botão dentro dele.
      var card = document.createElement(info.url ? 'button' : 'div');
      card.className = 'cf-module' + (MODULE_INFO[svc.key] ? ' is-' + svc.key : '') + (info.url ? '' : ' is-static');
      if (info.url) {
        card.type = 'button';
        card.title = 'Abre em nova aba';
        card.addEventListener('click', function () { openModule(info, svc.name); });
      }

      var corpo = document.createElement('div');
      corpo.className = 'cf-module-body';

      var cabeca = document.createElement('div');
      cabeca.className = 'cf-module-head';
      var tile = document.createElement('span');
      tile.className = 'cf-tile';
      tile.appendChild(icone(info.icone || 'i-modulo'));
      var chave = document.createElement('span');
      chave.className = 'cf-overline';
      chave.textContent = svc.name;
      cabeca.appendChild(tile);
      cabeca.appendChild(chave);

      var h2 = document.createElement('h2');
      h2.textContent = info.titulo || svc.name;
      var p = document.createElement('p');
      p.textContent = info.desc || 'Módulo ativo para sua empresa.';

      var tag = document.createElement('span');
      tag.className = 'cf-open';
      if (info.url) {
        tag.appendChild(document.createTextNode('Acessar ' + svc.name));
        var nova = document.createElement('span');
        nova.className = 'cf-sr-only';
        nova.textContent = ' (abre em nova aba)';
        tag.appendChild(nova);
        tag.appendChild(icone('i-seta'));
      } else {
        tag.textContent = 'Em configuração';
        tag.classList.add('cf-open-muted');
      }

      corpo.appendChild(cabeca);
      corpo.appendChild(h2);
      corpo.appendChild(p);
      corpo.appendChild(tag);
      card.appendChild(corpo);

      // Ilustração do módulo, se a página tiver uma para esta chave.
      var modelo = document.getElementById('ilustra-' + svc.key);
      if (modelo && modelo.content) {
        card.appendChild(modelo.content.cloneNode(true));
      }
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
    vivo = session.access_token;
    // O supabase-js renova a sessão sozinho em segundo plano; sem isto o hub
    // ficaria com o token do carregamento para sempre e uma aba velha mandaria
    // iat de dezenas de minutos, que o servidor recusa.
    CresceForteAuth.client.auth.onAuthStateChange(function (evento, s) {
      // Sem o ramo do SIGNED_OUT, o token da sessão encerrada continuaria em
      // memória e ainda seria mandado ao servidor depois de um logout feito em
      // outra aba. O servidor recusaria, mas não há motivo para transmitir.
      if (evento === 'SIGNED_OUT') { vivo = null; return; }
      if (s && s.access_token) { vivo = s.access_token; }
    });

    var emailEl = document.getElementById('user-email');
    var name = session.user.user_metadata && session.user.user_metadata.full_name;
    var identidade = name || session.user.email || '';
    emailEl.textContent = identidade;
    emailEl.title = identidade;
    // O avatar é o boneco do desenho (sprite i-pessoa); a identidade fica no
    // menu que ele abre.
    document.getElementById('user-menu-btn').title = identidade;

    var companyId = CresceForteAuth.getCompanyId(session);
    if (!companyId) { renderModules([]); return; }
    nomeDaEmpresa(companyId);

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

  // Nome da empresa, na saudação do topo e no menu do usuário. Consulta SEPARADA e opcional de
  // propósito: se a RLS/GRANT de `companies` não deixar o usuário comum ler, ou
  // a rede cair, a linha fica escondida e os módulos carregam igual — esta
  // leitura nunca pode derrubar a tela. E se não vier nome, não se inventa um:
  // não aparece um rótulo genérico no lugar.
  function nomeDaEmpresa(companyId) {
    CresceForteAuth.client
      .from('companies')
      .select('trade_name, legal_name')
      .eq('id', companyId)
      .maybeSingle()
      .then(function (r) {
        var linha = r && r.data;
        var nome = linha && (linha.trade_name || linha.legal_name);
        if (!nome) { return; }
        var chip = document.getElementById('area-chip');
        chip.textContent = 'Área ativa: ';
        var forte = document.createElement('b');
        forte.textContent = nome;
        chip.appendChild(forte);
        chip.hidden = false;
        var ola = document.getElementById('user-ola');
        // "bem-vindo(a)!" numa peça só: no celular a frase quebra em duas
        // linhas e não pode partir no hífen.
        ola.textContent = 'Olá, ' + nome + ', seja ';
        var fim = document.createElement('span');
        fim.className = 'cf-nowrap';
        fim.textContent = 'bem-vindo(a)!';
        ola.appendChild(fim);
        ola.title = ola.textContent;
      })
      .catch(function () { /* linha da empresa fica escondida */ });
  }

  // Menu do usuário (topo à direita): e-mail, empresa e Sair. Fecha com clique
  // fora, com Esc e ao abrir a gaveta do celular.
  var botaoUsuario = document.getElementById('user-menu-btn');
  var menuUsuario = document.getElementById('user-menu');
  function menuUsuarioAberto(abrir) {
    menuUsuario.hidden = !abrir;
    botaoUsuario.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  }
  botaoUsuario.addEventListener('click', function (e) {
    e.stopPropagation();
    menuUsuarioAberto(menuUsuario.hidden);
  });
  document.addEventListener('click', function (e) {
    if (!menuUsuario.hidden && !menuUsuario.contains(e.target)) { menuUsuarioAberto(false); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menuUsuario.hidden) { menuUsuarioAberto(false); botaoUsuario.focus(); }
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    CresceForteAuth.logout('/login/');
  });

  // Trilho em gaveta no celular. O botão e o véu só existem abaixo de 860px;
  // acima disso o CSS os esconde e estes ouvintes nunca disparam.
  (function () {
    var app = document.getElementById('app');
    var botao = document.getElementById('menu-btn');
    var veu = document.getElementById('scrim');
    function fechar() {
      app.classList.remove('rail-open');
      botao.setAttribute('aria-expanded', 'false');
      veu.hidden = true;
    }
    botao.addEventListener('click', function () {
      var abriu = !app.classList.contains('rail-open');
      app.classList.toggle('rail-open', abriu);
      botao.setAttribute('aria-expanded', abriu ? 'true' : 'false');
      veu.hidden = !abriu;
    });
    veu.addEventListener('click', fechar);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { fechar(); } });
  })();
})();
