// Aceite dos Termos de Uso e da Política de Privacidade no portal (LGPD,
// Alain 02/11/2026). Pergunta ao CRM (GET /api/auth/termos) se ESTA pessoa já
// aceitou a versão vigente; se não, abre uma janela que só fecha aceitando
// (POST /api/auth/termos grava data, versão, IP e navegador) ou saindo.
// O mesmo registro vale para o CRM e o Catálogo.
// Falha aberta: sem resposta do servidor, o portal segue e pergunta de novo no
// próximo acesso. Sem style= nem element.style: a CSP do site bloqueia; tudo em
// app-page.css (classes cf-termos-*).
(function (global) {
  'use strict';

  function el(tag, classe, texto) {
    var e = document.createElement(tag);
    if (classe) { e.className = classe; }
    if (texto) { e.textContent = texto; }
    return e;
  }

  function pedir(apiBase, token, metodo, corpo) {
    var cabecalhos = { Authorization: 'Bearer ' + token };
    if (corpo) { cabecalhos['Content-Type'] = 'application/json'; }
    return fetch(apiBase + '/auth/termos', { method: metodo, headers: cabecalhos, body: corpo ? JSON.stringify(corpo) : undefined })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (b) {
          return { ok: res.ok, status: res.status, dados: b && b.dados };
        });
      });
  }

  function abrirJanela(apiBase, tokenAtual, estado, aoSair) {
    var veu = el('div', 'cf-termos-veu');
    var caixa = el('div', 'cf-termos');
    caixa.setAttribute('role', 'dialog');
    caixa.setAttribute('aria-modal', 'true');
    caixa.setAttribute('aria-labelledby', 'cf-termos-titulo');

    var titulo = el('h2', null, 'Termos de Uso e Política de Privacidade');
    titulo.id = 'cf-termos-titulo';
    caixa.appendChild(titulo);
    caixa.appendChild(el('p', null, 'Para continuar usando a Cresce Forte, leia e aceite os documentos abaixo. Guardamos o registro do seu aceite (data, hora, versão, IP e navegador).'));

    var lista = el('ul', 'cf-termos-links');
    [['Termos de Uso', estado.termosUrl], ['Política de Privacidade', estado.privacidadeUrl]].forEach(function (d) {
      var li = el('li');
      var a = el('a', null, d[0]);
      a.href = d[1];
      a.target = '_blank';
      a.rel = 'noopener';
      li.appendChild(a);
      lista.appendChild(li);
    });
    caixa.appendChild(lista);

    var rotulo = el('label', 'cf-termos-marca');
    var caixaMarcar = el('input');
    caixaMarcar.type = 'checkbox';
    caixaMarcar.id = 'cf-termos-aceito';
    rotulo.setAttribute('for', 'cf-termos-aceito');
    rotulo.appendChild(caixaMarcar);
    rotulo.appendChild(el('span', null, 'Li e aceito os Termos de Uso e a Política de Privacidade da Cresce Forte.'));
    caixa.appendChild(rotulo);

    var erro = el('p', 'cf-termos-erro');
    erro.setAttribute('role', 'alert');
    erro.hidden = true;
    caixa.appendChild(erro);

    var aceitar = el('button', 'cf-termos-aceitar', 'Aceitar e continuar');
    aceitar.type = 'button';
    aceitar.disabled = true;
    caixaMarcar.addEventListener('change', function () { aceitar.disabled = !caixaMarcar.checked; });
    var sair = el('button', 'cf-termos-sair', 'Sair');
    sair.type = 'button';
    sair.addEventListener('click', aoSair);
    caixa.appendChild(aceitar);
    caixa.appendChild(sair);

    aceitar.addEventListener('click', function () {
      aceitar.disabled = true;
      aceitar.textContent = 'Registrando...';
      erro.hidden = true;
      pedir(apiBase, tokenAtual(), 'POST', { versao: estado.versao })
        .then(function (r) {
          if (r.ok) { veu.parentNode.removeChild(veu); return; }
          erro.textContent = r.status === 409
            ? 'Os termos foram atualizados. Recarregue a página para ler a versão nova.'
            : 'Não consegui registrar o aceite agora. Tente de novo em instantes.';
          erro.hidden = false;
        })
        .catch(function () {
          erro.textContent = 'Não consegui falar com o servidor. Verifique sua conexão e tente de novo.';
          erro.hidden = false;
        })
        .then(function () {
          if (veu.parentNode) {
            aceitar.textContent = 'Aceitar e continuar';
            aceitar.disabled = !caixaMarcar.checked;
          }
        });
    });

    veu.appendChild(caixa);
    document.body.appendChild(veu);
    caixaMarcar.focus();
  }

  global.CresceForteTermos = {
    // tokenAtual: função que devolve o access_token vivo (o supabase-js renova).
    conferir: function (apiBase, tokenAtual, aoSair) {
      var token = tokenAtual();
      if (!token) { return; }
      pedir(apiBase, token, 'GET')
        .then(function (r) {
          if (r.ok && r.dados && r.dados.aceito === false) { abrirJanela(apiBase, tokenAtual, r.dados, aoSair); }
        })
        .catch(function () { /* falha aberta: pergunta de novo no próximo acesso */ });
    }
  };
})(window);
