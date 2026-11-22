# Painel de administração do lumi

SvelteKit com `adapter-node`, no mesmo desenho do painel do porvia (ADR 0037 de lá). Fala com a API de administração do `lumi-server` (`LUMI_ADMIN_API_URL`, contrato em `server/docs/ADMIN.md`). App separado do cliente web: build, testes e imagem próprios; o cliente em `../src` não muda.

```bash
npm install
LUMI_ADMIN_API_URL=http://127.0.0.1:8081 npm run dev   # http://localhost:5174
npm test && npm run check && npm run build
```

## Modelo de segurança

- **O navegador nunca vê o token.** Entra-se colando um token `lpa_…` (criado só no terminal: `lumi-server token create painel`). O servidor do painel confere o token em `GET /admin/v1/status` e o guarda **só na memória do processo**, ligado a uma sessão aleatória (256 bits) num cookie `HttpOnly`, `SameSite=Strict`, `Secure` e `__Host-lumi_admin` fora de `localhost`. Validade de 12 h, nunca além da do token. Reiniciar o painel desloga todo mundo.
- **Toda chamada à API sai do servidor do painel** (BFF). Um XSS no painel não consegue ler o token; só agir dentro da sessão, como qualquer usuário do painel.
- **CSRF:** a proteção de origem dos formulários do Kit (a origem é fixada no build, `ORIGIN`) e o cookie `SameSite=Strict`.
- **CSP estrita** com nonce/hash para o bootstrap do Kit: `default-src 'none'`, `script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`. Nenhuma origem de terceiros (sem fontes, CDNs ou analytics). Mais `X-Frame-Options`, `nosniff`, `Referrer-Policy: same-origin`, COOP/CORP e `Cache-Control: no-store` em tudo.
- **O primeiro `401` da API encerra a sessão do painel** e volta para a entrada (token expirado ou revogado).
- **Ações destrutivas** pedem digitar o nome do alvo (usuário, slug do cofre, nome do token, slug do cofre da federação), e a ação no servidor confere de novo: o botão desabilitado não é a única barreira. Apagar um usuário dono de cofres (`409 sole_admin_vaults`) mostra os cofres e exige uma segunda confirmação explícita antes de mandar `delete_owned_vaults=true`.
- **Limite de entrada** por IP (backoff curto depois de 5 falhas); token malformado nem chega à API. A API tem o próprio limite.
- O IP de quem usa o painel vai para a API em `X-Forwarded-For` (só se for um endereço), para a auditoria e o limite de falhas. Atrás de um proxy, defina `ADDRESS_HEADER=x-forwarded-for` e `XFF_DEPTH=1` (só se o proxy sempre escreve o cabeçalho).
- "Sair" encerra só a sessão do painel: o token do terminal continua valendo até expirar ou ser revogado na página Tokens.

## Teclado

`g` e uma letra: `g i` visão geral, `g u` usuários, `g s` sessões, `g c` cofres, `g f` federações, `g t` tokens, `g a` auditoria. Diálogos nativos (`<dialog>`, Esc fecha), link "pular para o conteúdo", foco visível.
