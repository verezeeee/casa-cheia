# Poker System

Monorepo do sistema de poker online (cash games e torneios): backend, frontend PWA e infraestrutura de desenvolvimento.

## Stack

| Camada           | Tecnologia                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| Monorepo         | [pnpm workspaces](https://pnpm.io/workspaces) + [Turborepo](https://turborepo.dev) |
| Backend          | [NestJS](https://nestjs.com) (TypeScript) + [Prisma ORM](https://www.prisma.io) |
| Frontend         | [Next.js](https://nextjs.org) (App Router) como PWA + Tailwind CSS + TanStack Query |
| Banco de dados   | PostgreSQL (via Docker Compose)                                             |
| Tipos compartilhados | `packages/shared` (DTOs/enums/interfaces usados por backend e frontend) |
| CI               | GitHub Actions (lint, build, test com cobertura mínima)                     |

## Estrutura do repositório

```
.
├── apps/
│   ├── backend/            # API NestJS (Prisma, ConfigModule com validação Joi, Pino, Terminus)
│   │   ├── prisma/         # schema.prisma + migrations
│   │   ├── src/
│   │   │   ├── common/     # filtro global de exceções, etc.
│   │   │   ├── config/     # validação de env (Joi) e configuração tipada
│   │   │   ├── health/     # GET /health (Terminus + indicador do Prisma)
│   │   │   └── prisma/     # PrismaModule / PrismaService (injetável)
│   │   └── test/           # testes e2e (supertest)
│   └── frontend/           # Next.js App Router, PWA, Tailwind, TanStack Query
│       ├── public/         # manifest.json, ícones, service worker (sw.js)
│       └── src/
│           ├── app/        # rotas (App Router)
│           ├── components/ # providers (TanStack Query), PWA, UI
│           └── lib/        # env, cliente HTTP centralizado, query client
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
pnpm --filter @poker-system/backend run test:e2e
pnpm --filter @poker-system/frontend run dev
```

## Backend (`apps/backend`)

- **Config**: `ConfigModule` global com schema de validação **Joi** (`src/config/env.validation.ts`). O boot da aplicação falha com mensagem clara se faltar qualquer variável obrigatória (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET`).
- **Banco**: Prisma, schema em pasta (`prisma/schema/*.prisma`, um arquivo por bounded context — identity, wallet, table, tournament — mais `base.prisma` com generator/datasource/enums), com `PrismaService` injetável (`src/prisma`), conectando/desconectando junto ao ciclo de vida do módulo Nest. Domínio completo modelado e migration inicial aplicada (`prisma/schema/migrations`): dinheiro sempre `Decimal(14,2)`, ledgers append-only (`WalletTransaction`/`StackMovement`) com saldo materializado, `CHECK` constraints e índices únicos parciais para invariantes que o Prisma Schema Language não expressa nativamente — decisões documentadas no cabeçalho de `base.prisma`.
- **Logging**: estruturado via `nestjs-pino` (JSON em produção, `pino-pretty` em desenvolvimento).
- **Erros**: filtro global (`src/common/filters/http-exception.filter.ts`) padroniza todo erro no formato `{ statusCode, message, error?, timestamp, path }`, sem vazar stack trace na resposta HTTP.
- **Health check**: `GET /api/health` (Terminus), verificando a conexão com o PostgreSQL via Prisma.

## Frontend (`apps/frontend`)

- **PWA**: `public/manifest.json`, ícones e um service worker escrito à mão (`public/sw.js`, registrado por `src/components/pwa/service-worker-register.tsx`). Optou-se por não usar `next-pwa` (baseado em plugin webpack) devido à migração do Next.js para Turbopack como bundler padrão — ver comentários no próprio `sw.js`.
- **Cliente HTTP**: `src/lib/http-client.ts`, centralizado, lendo `NEXT_PUBLIC_API_URL` (nunca URL hardcoded). Erros HTTP são normalizados em `ApiError`, alinhados ao payload do filtro global do backend.
- **TanStack Query**: `QueryClientProvider` em `src/components/providers/query-provider.tsx`, envolvendo toda a árvore em `app/layout.tsx`.
- **Design system mínimo**: Tailwind CSS v4 (tokens em `src/app/globals.css`).

## Variáveis de ambiente

Veja `.env.example` na raiz para a lista completa e documentada (banco, JWT, AbacatePay/PIX, URL pública da API). Nunca commitar arquivos `.env*` reais — apenas os `*.example`.

## Qualidade de código

- **ESLint** (flat config, ESLint 9) + **Prettier** em todos os pacotes.
- **Husky + lint-staged**: no `pre-commit`, roda ESLint (com `--fix`) e Prettier apenas nos arquivos staged de cada pacote.
- **commitlint** (Conventional Commits): no hook `commit-msg`, bloqueia mensagens fora do padrão `tipo(escopo): descrição` (ex.: `feat(backend): adiciona endpoint de saldo`).
- **CI** (`.github/workflows/ci.yml`): jobs de `lint`, `build` e `test` (com serviço PostgreSQL para os testes de integração do backend), com cobertura mínima de ~70% configurada no Jest de backend e frontend.

## Decisões técnicas relevantes

- **Joi** (em vez de `class-validator`) para validar `process.env` no boot do backend — é o formato recomendado pelo próprio NestJS para esse caso de uso (objeto simples, com coerção de tipos e defaults). `class-validator` fica reservado para validação de DTOs de request via `ValidationPipe` (já habilitado globalmente).
- **PostgreSQL 16 (alpine)**, fixado por tag no `docker-compose.yml`, com volume nomeado persistente e healthcheck via `pg_isready`.
- **Service worker manual** no frontend em vez de `next-pwa`, para não depender de um plugin webpack em um projeto que já roda em Turbopack por padrão (Next.js 16).
- **Enums/DTOs de domínio** (`WalletTransactionType`, `TableType`, etc.) já esboçados em `packages/shared` para as próximas tasks (carteira/PIX, cash games, torneios), documentando desde já as premissas de separação entre saldo da Wallet e stack da mesa.

## Pendências para as próximas tasks do backlog

- Endpoints de autenticação (register/login/refresh/logout + guards/strategies de Passport). O `TokenService` (emissão/verificação de JWT) já existe em `src/auth`, mas o módulo ainda não está registrado no `AppModule` — faltam os controllers e a persistência do `RefreshToken`.
- Consumo do cliente AbacatePay já implementado em `src/integrations/abacatepay`: endpoints de depósito/saque PIX e verificação de assinatura de webhook (crédito idempotente na carteira).
- Regras de negócio de cash game/torneio (buy-in, cash-out, distribuição de prêmio) sobre o schema já modelado — separação Wallet vs. stack da mesa.
- Telas do frontend além do bootstrap (login, carteira, lobby de mesas/torneios).
