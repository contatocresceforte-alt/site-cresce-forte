/**
 * SESSÃO QUE TERMINA (Alain, 18/10): Site, CRM e Catálogo deslogam ao FECHAR O
 * NAVEGADOR e depois de 5 HORAS SEM USO.
 *
 * O Supabase guarda a sessão no localStorage, que sobrevive ao fechar o
 * navegador, e renova o token sozinho: sem isto, quem entrou uma vez ficava
 * dentro para sempre. Cada produto roda num subdomínio (localStorage não
 * atravessa), então o que os une é um COOKIE no domínio `.cresceforte.com`:
 *
 *   cf_sessao = "<início>.<última atividade>"   (milissegundos)
 *
 * sem data de validade — cookie de sessão, que o navegador apaga ao fechar.
 * `início` identifica esta abertura do navegador; cada produto guarda o início
 * em que entrou (localStorage, por origem). Ao abrir:
 *   - cookie ausente, ou início diferente do guardado → "fechou": o login
 *     guardado é de uma abertura anterior do navegador;
 *   - última atividade há mais de 5 h → "inativo".
 * Clique, tecla, rolagem e voltar à aba renovam a atividade — mas só depois
 * de conferir a regra: o computador que dormiu 6 h não pode ser "renovado"
 * pelo clique que o acorda.
 *
 * Cookie bloqueado no navegador: a regra não roda (não tranca ninguém fora).
 * Limite conhecido: Chrome/Edge com "continuar de onde parou" guardam até o
 * cookie de sessão; aí fechar não desloga, e vale só a regra das 5 h.
 *
 * MESMO ARQUIVO nos três repositórios (Site: assets/; CRM: apps/web/src/lib/;
 * Catálogo: este, usado pelo painel e pelo editor). Mudou aqui, muda lá.
 * Script clássico: publica em window.CFSessao.
 */
(function (global) {
  'use strict';

  var NOME = 'cf_sessao';
  var LIMITE_INATIVO_MS = 5 * 60 * 60 * 1000;
  var CONFERE_A_CADA_MS = 60 * 1000;
  var MARCA_NO_MAXIMO_A_CADA_MS = 60 * 1000;

  /** Regra pura: 'ok' | 'fechou' | 'inativo'. */
  function estado(valorDoCookie, inicioGuardado, agora) {
    var partes = String(valorDoCookie || '').split('.');
    var inicio = Number(partes[0]);
    var atividade = Number(partes[1]);
    if (!(inicio > 0) || !(atividade > 0)) return 'fechou';
    if (String(inicioGuardado || '') !== String(inicio)) return 'fechou';
    if (agora - atividade > LIMITE_INATIVO_MS) return 'inativo';
    return 'ok';
  }

  function doc() { return global.document; }

  function lerCookie() {
    var m = (doc().cookie || '').match(/(?:^|;\s*)cf_sessao=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function gravarCookie(valor) {
    var host = (global.location && global.location.hostname) || '';
    var dominio = /(^|\.)cresceforte\.com$/.test(host) ? '; Domain=.cresceforte.com' : '';
    var seguro = global.location && global.location.protocol === 'https:' ? '; Secure' : '';
    doc().cookie = NOME + '=' + encodeURIComponent(valor) + '; Path=/; SameSite=Lax' + dominio + seguro;
  }

  function chave(app) { return 'cf_sessao_inicio:' + app; }
  function lerInicio(app) { try { return global.localStorage.getItem(chave(app)); } catch (e) { return null; } }
  function gravarInicio(app, v) { try { global.localStorage.setItem(chave(app), String(v)); } catch (e) { /* sem storage: vale o cookie */ } }

  /** O navegador aceita o cookie? Sem isso a regra fica desligada. */
  function funciona() {
    try {
      var antes = lerCookie();
      var teste = antes || '1.1';
      gravarCookie(teste);
      var ok = lerCookie() === teste;
      if (!antes && ok) doc().cookie = NOME + '=; Path=/; Max-Age=0' + (/(^|\.)cresceforte\.com$/.test(global.location.hostname) ? '; Domain=.cresceforte.com' : '');
      return ok;
    } catch (e) {
      return false;
    }
  }

  function partes() {
    var p = lerCookie().split('.');
    return { inicio: Number(p[0]) || 0, atividade: Number(p[1]) || 0 };
  }

  /**
   * Login que acabou de dar certo (senha ou ticket do portal). Se esta
   * abertura do navegador já tem início válido (outro produto entrou antes),
   * entra nele; senão começa um novo.
   */
  function entrou(app, agora) {
    if (!funciona()) return;
    agora = agora || Date.now();
    var p = partes();
    var vivo = p.inicio > 0 && p.atividade > 0 && agora - p.atividade <= LIMITE_INATIVO_MS;
    var inicio = vivo ? p.inicio : agora;
    gravarCookie(inicio + '.' + agora);
    gravarInicio(app, inicio);
  }

  /** Estado agora, para quem tem um login guardado deste produto. */
  function confere(app, agora) {
    return estado(lerCookie(), lerInicio(app), agora || Date.now());
  }

  var ultimaMarca = 0;
  function marca(agora) {
    if (agora - ultimaMarca < MARCA_NO_MAXIMO_A_CADA_MS) return;
    ultimaMarca = agora;
    gravarCookie(partes().inicio + '.' + agora);
  }

  /**
   * Vigia um login guardado deste produto. `sair(motivo)` é chamado UMA vez,
   * na abertura ou depois, quando a regra disser que acabou. Devolve uma
   * função que para a vigia (ao sair por conta própria).
   */
  function vigiar(app, sair) {
    if (!funciona()) return function () {};
    var parado = false;
    var timer = null;
    var eventos = ['pointerdown', 'keydown', 'scroll', 'touchstart'];

    function parar() {
      parado = true;
      if (timer) global.clearInterval(timer);
      eventos.forEach(function (ev) { global.removeEventListener(ev, atividade, true); });
      doc().removeEventListener('visibilitychange', aoVoltar);
    }
    function terminou() {
      var e = confere(app);
      if (e === 'ok') return false;
      parar();
      sair(e);
      return true;
    }
    function atividade() {
      if (parado || terminou()) return;
      marca(Date.now());
    }
    function aoVoltar() { if (doc().visibilityState === 'visible') atividade(); }

    if (terminou()) return parar;
    ultimaMarca = 0;
    marca(Date.now());
    eventos.forEach(function (ev) { global.addEventListener(ev, atividade, { capture: true, passive: true }); });
    doc().addEventListener('visibilitychange', aoVoltar);
    timer = global.setInterval(function () { if (!parado) terminou(); }, CONFERE_A_CADA_MS);
    return parar;
  }

  var TEXTO = {
    fechou: 'Sua sessão terminou porque o navegador foi fechado. Entre de novo.',
    inativo: 'Sua sessão terminou depois de 5 horas sem uso. Entre de novo.'
  };

  /* O motivo atravessa o recarregamento até a tela de login (sessionStorage,
     da aba): quem saiu sem clicar em "Sair" precisa saber por quê. */
  function guardaMotivo(motivo) { try { global.sessionStorage.setItem('cf_sessao_motivo', motivo); } catch (e) { /* sem storage: sai sem o recado */ } }
  function pegaMotivo() {
    try {
      var m = global.sessionStorage.getItem('cf_sessao_motivo');
      global.sessionStorage.removeItem('cf_sessao_motivo');
      return TEXTO[m] || null;
    } catch (e) { return null; }
  }

  global.CFSessao = {
    estado: estado, entrou: entrou, confere: confere, vigiar: vigiar,
    guardaMotivo: guardaMotivo, pegaMotivo: pegaMotivo, texto: TEXTO,
    LIMITE_INATIVO_MS: LIMITE_INATIVO_MS
  };
})(typeof window !== 'undefined' ? window : globalThis);
