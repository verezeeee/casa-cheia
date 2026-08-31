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
