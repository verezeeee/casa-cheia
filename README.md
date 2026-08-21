# Poker System

Monorepo do sistema de **gestão/caixa de uma casa de poker**: carteira virtual com PIX, mesas de cash game (buy-in/cash-out) e torneios (inscrição, eliminação, premiação). **Não é** um motor de poker online — não há cartas, rodadas de aposta ou sincronização em tempo real; o jogo acontece fisicamente na mesa, o sistema só registra o dinheiro.

## Stack

| Camada           | Tecnologia                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| Monorepo         | [pnpm workspaces](https://pnpm.io/workspaces) + [Turborepo](https://turborepo.dev) |
| Backend          | [NestJS](https://nestjs.com) (TypeScript) + [Prisma ORM](https://www.prisma.io) |
| Frontend         | [Next.js](https://nextjs.org) (App Router) como PWA + Tailwind CSS v4 + TanStack Query |
| Banco de dados   | PostgreSQL (via Docker Compose)                                             |
| Tipos compartilhados | `packages/shared` (DTOs/enums/interfaces usados por backend e frontend) |
| CI               | GitHub Actions (lint, build, test com cobertura mínima)                     |

## Estrutura do repositório

```
.
├── apps/
│   ├── backend/            # API NestJS
│   │   ├── prisma/         # schema.prisma (por bounded context) + migrations
│   │   ├── src/
│   │   │   ├── auth/       # registro, login, refresh (rotação + detecção de reuso), guards
│   │   │   ├── wallet/     # saldo, extrato, depósito/saque PIX, webhook AbacatePay
│   │   │   ├── table/      # mesas de cash game: lobby, assentos, buy-in, cash-out, ajustes
│   │   │   ├── tournament/ # torneios: grade de premiação, inscrição, eliminação, payout
│   │   │   ├── integrations/abacatepay/  # cliente do gateway PIX
│   │   │   ├── common/     # filtro global de exceções, paginação por cursor,
│   │   │   │                # crypto (Argon2/HMAC), Idempotency-Key, rate limits
│   │   │   ├── config/     # validação de env (Joi) e configuração tipada
│   │   │   ├── health/     # GET /health (Terminus + indicador do Prisma)
│   │   │   └── prisma/     # PrismaModule / PrismaService (injetável)
│   │   └── test/           # e2e (supertest, Postgres real) e testes de integração
│   └── frontend/           # Next.js App Router, PWA, Tailwind, TanStack Query
│       ├── public/         # manifest.json, ícones, service worker (sw.js)
│       └── src/
│           ├── app/        # rotas: /login, /register, /lobby, /tables/[id],
│           │                # /tournaments, /tournaments/[id], /wallet
│           ├── components/ # auth, wallet, table, tournament, providers, ui (design system)
│           └── lib/        # env, cliente HTTP centralizado, formatadores, clients de API
├── packages/
│   └── shared/              # tipos/DTOs/enums compartilhados (@poker-system/shared)
├── .github/workflows/ci.yml # pipeline de CI (lint, build, test)
├── docker-compose.yml       # PostgreSQL + pgAdmin (opcional) para desenvolvimento
├── .env.example              # todas as variáveis de ambiente do projeto, documentadas
└── turbo.json / pnpm-workspace.yaml
```

## Pré-requisitos

- Node.js >= 20
- pnpm >= 10 (`corepack enable` ou `npm i -g pnpm`)
- Docker + Docker Compose (para o PostgreSQL local)

## Primeiros passos

```bash
# 1. Instalar dependências de todo o monorepo
pnpm install

# 2. Subir o PostgreSQL (e, opcionalmente, o pgAdmin) via Docker Compose
cp .env.example .env
pnpm docker:up
# pgAdmin (opcional): docker compose --profile tools up -d

# 3. Configurar env vars dos apps
cp .env.example apps/backend/.env
cp .env.example apps/frontend/.env.local   # editar mantendo só as NEXT_PUBLIC_*

# 4. Gerar o Prisma Client e rodar as migrations
pnpm --filter @poker-system/backend exec prisma generate
pnpm --filter @poker-system/backend exec prisma migrate dev

# 5. Build de todo o monorepo (com cache do Turborepo)
pnpm build

# 6. Subir backend e frontend em modo dev (em paralelo)
pnpm dev
```

- Backend: http://localhost:3001/api (health check em `/api/health`)
- Frontend: http://localhost:3000

## Comandos principais (raiz do monorepo)

| Comando               | Descrição                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `pnpm install`          | Instala as dependências de todos os workspaces                    |
| `pnpm dev`              | Roda backend e frontend em modo desenvolvimento (via Turborepo)   |
| `pnpm build`            | Build de todos os pacotes/apps, respeitando o grafo de dependências e cache do Turborepo |
| `pnpm lint`             | Lint em todos os pacotes/apps                                     |
| `pnpm format` / `format:check` | Formata (ou verifica) todo o repositório com Prettier      |
| `pnpm test` / `test:cov` | Testes unitários (com cobertura) em todos os pacotes/apps        |
| `pnpm docker:up` / `docker:down` | Sobe/derruba o PostgreSQL (e serviços opcionais) via Docker Compose |

Comandos específicos de um pacote podem ser rodados com `pnpm --filter <pacote> <script>`, por exemplo:

```bash
pnpm --filter @poker-system/backend run test:e2e   # e2e contra Postgres real
pnpm --filter @poker-system/backend run test:int   # testes de integração (invariantes de schema)
pnpm --filter @poker-system/frontend run dev
```

## Backend (`apps/backend`)

- **Config**: `ConfigModule` global com schema de validação **Joi** (`src/config/env.validation.ts`). O boot da aplicação falha com mensagem clara se faltar qualquer variável obrigatória (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET`).
- **Banco**: Prisma, schema em pasta (`prisma/schema/*.prisma`, um arquivo por bounded context — identity, wallet, table, tournament — mais `base.prisma` com generator/datasource/enums), com `PrismaService` injetável (`src/prisma`). Dinheiro sempre `Decimal(14,2)` (nunca `number`/IEEE-754); ledgers append-only (`WalletTransaction`/`StackMovement`) com saldo materializado; `CHECK` constraints e índices únicos parciais para invariantes que o Prisma Schema Language não expressa nativamente.
- **Auth** (`src/auth`): registro (cria `User` + `Wallet` com saldo 0 na mesma transação), login, refresh com rotação de token e detecção de reuso (token revogado reapresentado derruba a família inteira), logout, `GET /me`. Refresh token em cookie `httpOnly`+`Secure`+`SameSite`; access token via `Authorization: Bearer`. `JwtAuthGuard`/`RolesGuard`+`@Roles()` para rotas `ADMIN`.
- **Wallet** (`src/wallet`): saldo, extrato paginado por cursor, depósito e saque PIX via `AbacatePayClient`, webhook de confirmação (assinatura HMAC + janela anti-replay + deduplicação por `WebhookEvent`). Toda mutação de saldo passa por `WalletService.applyLedgerEntry` — chokepoint único com lock pessimista (`SELECT ... FOR UPDATE`) e matemática em `Decimal`.
- **Table** (`src/table`): lobby de mesas de cash game, assentos, buy-in/cash-out (débito/crédito da wallet via `applyLedgerEntry`) e ajuste de stack (`HAND_RESULT`/`ADJUSTMENT`, sem tocar a wallet).
- **Tournament** (`src/tournament`): criação com grade de premiação (soma de percentuais validada em 100%), inscrição (débito de `buyIn+fee`), eliminação, encerramento com inferência do campeão e crédito da premiação por colocação (idempotente por inscrição).
- **Idempotência**: header `Idempotency-Key` obrigatório em todo POST financeiro (depósito, saque, buy-in, cash-out, inscrição) — validação compartilhada em `src/common/http/require-idempotency-key.ts`.
- **Rate limiting**: `ThrottlerModule` global (limite generoso, não atrapalha polling normal) com limite estrito sobrescrito via `@Throttle()` em login/depósito/saque (`RATE_LIMIT_TTL`/`RATE_LIMIT_LIMIT`).
- **Logging**: estruturado via `nestjs-pino` (JSON em produção, `pino-pretty` em desenvolvimento).
- **Erros**: filtro global (`src/common/filters/http-exception.filter.ts`) padroniza todo erro no formato `{ statusCode, message, error?, timestamp, path }`, sem vazar stack trace na resposta HTTP.
- **Health check**: `GET /api/health` (Terminus), verificando a conexão com o PostgreSQL via Prisma.

## Frontend (`apps/frontend`)

- **PWA**: `public/manifest.json`, ícones e um service worker escrito à mão (`public/sw.js`, registrado por `src/components/pwa/service-worker-register.tsx`). Optou-se por não usar `next-pwa` (baseado em plugin webpack) devido à migração do Next.js para Turbopack como bundler padrão.
- **Sessão**: `SessionProvider` mantém o access token em memória (nunca `localStorage`), hidrata via `GET /auth/me`/`refresh` e expõe `useSession()`; `RequireAuth` protege rotas.
- **Cliente HTTP**: `src/lib/http-client.ts`, centralizado, lendo `NEXT_PUBLIC_API_URL` (nunca URL hardcoded). Erros HTTP são normalizados em `ApiError`; um 401 dispara uma tentativa de refresh antes de propagar. Um client por módulo de domínio (`lib/api/{auth,wallet,table,tournament}.ts`).
- **TanStack Query**: `QueryClientProvider` em `src/components/providers/query-provider.tsx`, envolvendo toda a árvore em `app/layout.tsx`.
- **Telas**: `/login`, `/register`, `/lobby` (mesas), `/tables/:id` (assentos, buy-in, cash-out, ajuste de stack), `/tournaments` (lista + criação admin com grade de premiação), `/tournaments/:id` (detalhe, inscrição, eliminação e encerramento admin), `/wallet` (saldo, depósito PIX, saque, extrato).
- **Design system**: Tailwind CSS v4 com tokens semânticos (`src/app/globals.css`) — paleta de feltro/tinta/latão, tipografia Fraunces (display) + IBM Plex Sans/Mono, componentes em `src/components/ui`.

## Variáveis de ambiente

Veja `.env.example` na raiz para a lista completa e documentada (banco, JWT, AbacatePay/PIX, rate limiting, URL pública da API). Nunca commitar arquivos `.env*` reais — apenas os `*.example`.

## Qualidade de código

- **ESLint** (flat config, ESLint 9) + **Prettier** em todos os pacotes.
- **Husky + lint-staged**: no `pre-commit`, roda ESLint (com `--fix`) e Prettier apenas nos arquivos staged de cada pacote.
- **commitlint** (Conventional Commits): no hook `commit-msg`, bloqueia mensagens fora do padrão `tipo(escopo): descrição` (ex.: `feat(backend): adiciona endpoint de saldo`).
- **CI** (`.github/workflows/ci.yml`): jobs de `lint`, `build` e `test` (com serviço PostgreSQL para os testes de integração/e2e do backend), com cobertura mínima de ~70% configurada no Jest de backend e frontend.
- Cada módulo do backend tem testes unitários (Prisma mockado), um teste e2e contra Postgres real (`apps/backend/test/*.e2e-spec.ts`) e, quando aplicável, testes de integração de invariantes de schema (`*.int-spec.ts`). `test/smoke.e2e-spec.ts` cobre o fluxo de dinheiro ponta a ponta (registrar → depositar → sentar → cash-out → sacar).

## Decisões técnicas relevantes

- **Joi** (em vez de `class-validator`) para validar `process.env` no boot do backend — formato recomendado pelo próprio NestJS para esse caso de uso. `class-validator` fica reservado para DTOs de request via `ValidationPipe` (habilitado globalmente).
- **Ledger append-only + saldo materializado**: toda mutação de dinheiro (Wallet ou stack de mesa) grava uma linha de movimento imutável e atualiza um saldo materializado na mesma transação, sob lock pessimista — nunca um `UPDATE` de saldo isolado.
- **Lock otimista** (`version`) em `TableSession`/`Tournament` para operações concorrentes que não precisam do lock pessimista da wallet.
- **Paginação por cursor** (`createdAt`+`id`, base64url) reutilizada entre wallet/table/tournament — `src/common/pagination/cursor.ts`.
- **PostgreSQL 16 (alpine)**, fixado por tag no `docker-compose.yml`, com volume nomeado persistente e healthcheck via `pg_isready`.
- **Service worker manual** no frontend em vez de `next-pwa`, para não depender de um plugin webpack em um projeto que já roda em Turbopack por padrão (Next.js 16).
