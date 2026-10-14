# Deploy (Vercel)

Backend e frontend são deployados como **dois projetos Vercel separados**
neste monorepo, disparados por GitHub Actions em push na `main` só depois
que `lint`/`build`/`test` passarem (ver `.github/workflows/ci.yml`, jobs
`deploy-backend`/`deploy-frontend`).

## Setup inicial (uma vez, feito localmente por quem tem acesso à conta Vercel)

1. `npx vercel login`
2. Linkar o backend:
   ```
   cd apps/backend && npx vercel link
   ```
   Isso cria o projeto na Vercel com Root Directory = `apps/backend` e grava
   `.vercel/project.json` (gitignored) com `orgId` e `projectId`.
3. Repetir para o frontend: `cd apps/frontend && npx vercel link`.
4. No dashboard da Vercel, configurar as env vars de **produção** de cada
   projeto:
   - **backend**: todas as variáveis obrigatórias/usadas em
     `apps/backend/src/config/env.validation.ts` — no mínimo `DATABASE_URL`,
     `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGINS` (com a URL de
     produção do frontend), `COOKIE_SECURE=true`, `COOKIE_DOMAIN`.
   - **frontend**: `NEXT_PUBLIC_API_URL` apontando para a URL de produção do
     backend (ex.: `https://poker-backend.vercel.app/api`).
5. Criar 4 secrets no GitHub (Settings → Secrets and variables → Actions):
   - `VERCEL_TOKEN` — gerado em vercel.com/account/tokens.
   - `VERCEL_ORG_ID` — em `apps/backend/.vercel/project.json` (`orgId`).
   - `VERCEL_BACKEND_PROJECT_ID` — mesmo arquivo, campo `projectId`.
   - `VERCEL_FRONTEND_PROJECT_ID` — `projectId` de `apps/frontend/.vercel/project.json`.

Feito isso, todo push na `main` que passar no CI deploya os dois projetos
automaticamente.

## Verificar

```
curl https://<backend>.vercel.app/api/health
```

# Deploy (VPS / EasyPanel, via Docker)

Alternativa self-hosted aos dois Dockerfiles multi-stage em
`apps/backend/Dockerfile` e `apps/frontend/Dockerfile`, pensados para um
PostgreSQL JÁ EXISTENTE na mesma VPS (outro serviço do EasyPanel, não
gerenciado por estes Dockerfiles) — sem Neon/PgBouncer, sem Vercel.

Build sempre a partir da RAIZ do monorepo (os dois Dockerfiles copiam
`packages/shared`, do qual backend e frontend dependem):

```
docker build -f apps/backend/Dockerfile -t poker-backend .
docker build -f apps/frontend/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.seu-dominio.com/api \
  -t poker-frontend .
```

No EasyPanel: criar um serviço "App" por imagem, apontando pro Dockerfile
correspondente (Build Context = raiz do repo, Dockerfile Path = o caminho
acima), e configurar o build arg `NEXT_PUBLIC_API_URL` do frontend no próprio
serviço.

## Variáveis de ambiente

**Backend** (ver lista completa em `apps/backend/src/config/env.validation.ts`
e `.env.example` na raiz):

- `DATABASE_URL` e `DIRECT_URL` — **a MESMA string** apontando pro Postgres da
  VPS (ex.: `postgresql://poker:SENHA@postgres:5432/poker_system?schema=public`,
  usando o nome do serviço do Postgres no EasyPanel como host). Sem pooler
  (PgBouncer) numa instalação assim, as duas variáveis não precisam divergir
  como divergem em produção na Vercel (Neon).
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — strings aleatórias longas (`openssl
  rand -base64 48`), nunca reaproveitadas de outro ambiente.
- `NODE_ENV=production` — já setado pelo Dockerfile; não precisa (nem deve)
  ser sobrescrito.
- `COOKIE_SECURE=true` — obrigatório com `NODE_ENV=production` (o processo
  recusa subir com `false`); exige que o domínio sirva o backend sobre HTTPS.
- `CORS_ORIGINS` — URL pública do frontend (ex.:
  `https://app.seu-dominio.com`).
- `RUN_MIGRATIONS` — `true` (padrão) roda `prisma migrate deploy`
  automaticamente a cada start do container (idempotente, seguro em todo
  restart); `false` pula esse passo, caso as migrations sejam aplicadas à
  parte (ver `docker-entrypoint.sh`).

**Frontend**: `NEXT_PUBLIC_API_URL` é embutida no bundle do CLIENTE em tempo
de BUILD — setá-la só como env do container em runtime NÃO tem efeito.
Qualquer mudança na URL pública da API exige rebuildar a imagem com um novo
`--build-arg`.

## Portas e health check

- Backend escuta em `3001` (`PORT`), rota de health em `/api/health`
  (`API_PREFIX`).
- Frontend escuta em `3000` (`PORT`).
- As duas imagens têm `HEALTHCHECK` nativo do Docker — o EasyPanel lê esse
  status automaticamente, sem configuração extra.

## Verificar

```
curl https://<backend>/api/health
```
