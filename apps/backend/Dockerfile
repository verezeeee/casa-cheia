# syntax=docker/dockerfile:1.7
#
# Backend (NestJS + Prisma) — imagem standalone para deploy em VPS/EasyPanel,
# contra um PostgreSQL externo (outro serviço da mesma VPS, não gerenciado por
# este Dockerfile).
#
# Build a partir da RAIZ do monorepo (necessário para enxergar
# packages/shared, do qual o backend depende):
#   docker build -f apps/backend/Dockerfile -t poker-backend .
#
# Variáveis de ambiente obrigatórias em runtime (ver apps/backend/src/config/
# env.validation.ts e .env.example na raiz): DATABASE_URL, DIRECT_URL (mesma
# string que DATABASE_URL quando não há pooler, caso de um Postgres comum de
# VPS), JWT_SECRET, JWT_REFRESH_SECRET. Em produção (NODE_ENV=production,
# setado abaixo) COOKIE_SECURE é OBRIGATORIAMENTE "true" — o processo recusa
# subir com "false" (validação Joi, fail-fast).
#
# Base `node:20-bookworm` (imagem CHEIA, não `-slim`) de propósito: ela já
# traz python3/make/g++ (fallback de compilação nativa do argon2 via
# node-gyp, quando não há prebuild pra plataforma/ABI exatos — visto
# acontecer de verdade), openssl (exigido pelo Prisma Query Engine em
# `generate` e em runtime) e curl (usado pelo HEALTHCHECK). Evita depender de
# `apt-get` conseguir alcançar os mirrors da Debian a partir de dentro do
# build — rede que nem todo ambiente de CI/VPS libera por padrão.

FROM node:20-bookworm AS base
RUN corepack enable

# ----------------------------------------------------------------------------
# 1) Build: instala o monorepo inteiro (dev+prod) e compila shared + backend.
# ----------------------------------------------------------------------------
FROM base AS build
WORKDIR /app

# Copiados primeiro (cache de camada): só muda em bump de dependência, não a
# cada mudança de código-fonte. `prisma/schema` entra junto (e não só o
# `package.json`) porque o `postinstall` do backend (`prisma generate`) RODA
# DURANTE este `pnpm install` — sem o schema já presente aqui, a instalação
# inteira falha ("Could not load schema from `prisma/schema`").
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/backend/prisma apps/backend/prisma
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm turbo run build --filter=@poker-system/backend

# `pnpm deploy`: empacota o workspace do backend + SÓ as dependências de
# produção num diretório autocontido (sem symlink pro resto do monorepo) —
# o padrão oficial do pnpm para Docker (https://pnpm.io/docker). `--legacy`
# porque o pnpm 10 passou a exigir `inject-workspace-packages=true` pro modo
# novo de deploy; o legado resolve `workspace:*` copiando o pacote já
# buildado — validado manualmente que `packages/shared/dist` vem junto e que
# `node_modules/.bin/prisma` (usado pelo entrypoint pra migrar) sobrevive ao
# `--prod` (ver `dependencies.prisma` em apps/backend/package.json).
RUN pnpm --filter=@poker-system/backend deploy --prod --legacy /app/deploy

# ----------------------------------------------------------------------------
# 2) Runtime: imagem limpa, sem devDependencies nem fontes de outros apps.
# ----------------------------------------------------------------------------
FROM node:20-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --system --no-create-home nestjs

COPY --from=build --chown=nestjs:nodejs /app/deploy ./
RUN chmod +x ./docker-entrypoint.sh

USER nestjs

# Mesmos defaults do schema de validação (env.validation.ts) — só documentam
# o valor que a imagem assume se a env não vier setada do host.
ENV PORT=3001
ENV API_PREFIX=api
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/${API_PREFIX}/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
