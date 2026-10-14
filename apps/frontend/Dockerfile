# syntax=docker/dockerfile:1.7
#
# Frontend (Next.js) — imagem standalone para deploy em VPS/EasyPanel.
#
# Build a partir da RAIZ do monorepo (necessário para enxergar
# packages/shared, do qual o frontend depende):
#   docker build -f apps/frontend/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.seu-dominio.com/api \
#     -t poker-frontend .
#
# IMPORTANTE: `NEXT_PUBLIC_API_URL` é embutida no bundle do CLIENTE em tempo
# de BUILD (o compilador do Next substitui `process.env.NEXT_PUBLIC_API_URL`
# por uma string literal) — trocar essa env só no container em runtime NÃO
# tem efeito nenhum. Qualquer mudança na URL pública da API exige rebuildar
# a imagem com um novo `--build-arg`.

FROM node:20-bookworm AS base
RUN corepack enable

# ----------------------------------------------------------------------------
# 1) Build: instala o monorepo inteiro (dev+prod) e compila shared + frontend.
# ----------------------------------------------------------------------------
FROM base AS build
WORKDIR /app

# Copiados primeiro (cache de camada): só muda em bump de dependência, não a
# cada mudança de código-fonte.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/frontend apps/frontend

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# `output: 'standalone'` (next.config.ts) gera um server Node self-contido
# em `.next/standalone` — só os arquivos e dependências de produção
# realmente usados (tracing do próprio Next). `.next/static` e `public/`
# ficam de FORA dele de propósito (são servidos como arquivo estático, não
# fazem parte do tracing de módulos) — copiados manualmente no estágio de
# runtime abaixo, conforme a própria documentação do Next.js.
RUN pnpm turbo run build --filter=@poker-system/frontend

# ----------------------------------------------------------------------------
# 2) Runtime: imagem limpa, só o output standalone + estáticos.
# ----------------------------------------------------------------------------
FROM node:20-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --system --no-create-home nextjs

COPY --from=build --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/frontend/public ./apps/frontend/public

USER nextjs
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# Node 20 já tem `fetch` global — usa ele pro HEALTHCHECK em vez de curl,
# sem diferença prática aqui (a imagem `node:20-bookworm` cheia tem os dois).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/frontend/server.js"]
