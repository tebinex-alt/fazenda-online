# Fazenda Real — Front separado do Backend

O jogo foi dividido em duas partes independentes:

```
fazenda-real/
├── backend/            ← Servidor Node.js (sem dependências externas)
│   ├── server.js        API + arquivos estáticos
│   ├── db.js            SQLite (node:sqlite) + migração do store.json
│   ├── auth.js          hash de senha (scrypt), sessões, login/registro
│   ├── ratelimit.js     limite de abuso por IP
│   ├── routes.js        handlers da API (KV + desafios online)
│   ├── package.json
│   └── data/
│       ├── fazenda.db   banco SQLite (WAL)
│       └── store.json.bak   backup do save antigo, após migrar
└── frontend/            ← Tudo que roda no navegador
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── storage-client.js   fala com o backend (Storage + Auth)
        ├── config.js           constantes do jogo (raças, tiers, custos...)
        ├── state.js            modelo do estado (freshState, mkPlot, etc.)
        ├── utils.js            helpers (fmt, toast, confirmAction...)
        ├── persistence.js      salvar/carregar o jogo
        ├── engine.js           loop do jogo (produção, tick, cruzas)
        ├── actions.js          ações do jogador (comprar, vender, treinar...)
        ├── multiplayer.js      salas online, publicar/desafiar galos
        ├── ui.js                renderização das telas
        ├── events.js            ligação dos cliques aos handlers
        └── main.js              inicialização (gate de login)
```

## Como funciona agora

- **Contas com usuário e senha.** Cada jogador cria uma conta; o save fica
  ligado à conta e pode ser jogado de qualquer aparelho. Senhas são guardadas
  com hash scrypt (nunca em texto puro).
- **Sessão por cookie.** O navegador guarda um cookie `fazenda_sid`
  (HttpOnly, SameSite=Lax). O servidor só guarda o hash do token; expira em
  30 dias e renova no uso.
- **SQLite.** Tudo persiste em `backend/data/fazenda.db` via `node:sqlite`
  (nativo do Node 22.5+, zero dependências). Nada de `npm install`.
- **Posse real das aves publicadas.** A chave `mp:<SALA>:bird:<pubId>` tem
  dono no servidor: só o dono consegue sobrescrever. Resultados de desafios
  online são registrados pelo servidor (`POST /api/challenges`), que atualiza
  o win/loss da ave do oponente e anexa ao log da sala de forma atômica.
- **Migração automática do save antigo.** Na primeira vez que o servidor roda,
  o `backend/data/store.json` é migrado para o SQLite e renomeado para
  `store.json.bak`. Os saves pessoais antigos viram códigos de reivindicação:
  na tela de **Criar conta** há um campo "Código do seu save antigo" — o
  jogador cola o código `u_...` que estava no navegador antigo (veja abaixo
  como descobri-lo) e a fazenda dele é transferida para a conta, uma única vez.

## Como rodar

Requer **Node.js 22.5+** (usa `node:sqlite`; recomendado Node 24).

```bash
cd backend
npm start
# ou: node server.js
```

Abra **http://localhost:3000** no navegador. O backend serve o frontend e a
API na mesma porta.

Variáveis de ambiente:

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `TRUST_PROXY` | — | `true` se rodar atrás de proxy (Caddy/nginx). Faz o cookie usar `Secure` e respeitar `X-Forwarded-For` no rate limit |
| `COOKIE_SECURE` | automático | Força o cookie `Secure` mesmo sem `TRUST_PROXY` |

## Jogando com amigos na internet pública

O servidor fala HTTP puro; para a internet você coloca um proxy HTTPS na
frente. Exemplos:

**Caddy** (certificado automático, mais simples):

```
fazenda.example.com {
    reverse_proxy localhost:3000
}
```

**nginx** (com certbot):

```nginx
server {
    server_name fazenda.example.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

E rode o backend com `TRUST_PROXY=true` (necessário para o cookie `Secure` e
para o rate limit enxergar o IP real do jogador).

## Recuperando um save antigo (pré-contas)

O código do seu save antigo era gerado pelo navegador e guardado em
`localStorage` na chave `fazenda-user-id` (algo como `u_x2lb8x61msgo8718`).

Para descobri-lo no navegador antigo:

```js
localStorage.getItem('fazenda-user-id')
```

Ou, com o jogo aberto, digite no Console:

```js
getUserId()
```

Cole esse código no campo "Código do seu save antigo" na tela de criar conta.
A transferência acontece só uma vez — depois disso o código deixa de valer.

## Backup

- **Banco:** `backend/data/fazenda.db` (modo WAL). Para copiar com o servidor
  rodando, use `sqlite3 fazenda.db ".backup backup.db"` (se tiver o sqlite3)
  ou copie o arquivo com o servidor parado.
- **Save antigo:** `backend/data/store.json.bak` fica como resgate caso você
  precise migrar de novo manualmente.

## Notas de segurança

- Senhas: hash scrypt com salt de 16 bytes (`salt:hash` em hex), comparação em
  tempo constante (`timingSafeEqual`).
- SQL: só prepared statements — nada de concatenação de strings.
- Rate limit por IP em memória: `/api/auth/*` 10 req/min, demais `/api/*`
  120 req/min; 10 falhas de login numa conta em 15 min → bloqueio de 15 min.
- Sessões: só o hash do token fica no banco; expiram em 30 dias e são
  varridas periodicamente.
- O resultado da luta online continua calculado no navegador (como sempre
  foi); o servidor apenas registra o log e os contadores de forma atômica.
