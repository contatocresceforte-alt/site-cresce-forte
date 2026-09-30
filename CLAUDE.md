# Site Cresce Forte — guia para o Claude

**Este repositório é público, e o GitHub Pages publica em cresceforte.com, em
cerca de um minuto, tudo o que estiver na `main`.** Por isso:

- Nunca commitar senha, chave, token, `.env`, dado de cliente, documento interno ou rascunho. Nem em ramo: o repositório inteiro é público.
- Push na `main` é produção. CSS e texto sobem direto. Mudança de comportamento (login, hub, `/admin/`) é avisada ao dono antes de subir.
- O login do hub entrega a sessão ao CRM e ao Catálogo: mudança nele sobe por último, depois dos dois.
- Não há build nem testes automáticos: sirva a pasta (`npx http-server .` ou `python -m http.server`) e confira no navegador, também na largura de celular.
- O HTML servido difere do arquivo do repositório pelo script de métricas que o Cloudflare injeta; para provar que subiu, compare JS, CSS e imagens, ou procure o texto novo na página.

As regras completas e o mapa da plataforma ficam no `CLAUDE.md` do repositório privado do CRM.
