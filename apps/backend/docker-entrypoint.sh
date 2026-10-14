#!/bin/sh
# Entrypoint do container de produção do backend.
#
# `prisma migrate deploy` é IDEMPOTENTE (só aplica migrations pendentes, é
# a própria Prisma quem recomenda rodá-lo a cada start em produção) — seguro
# de rodar em todo restart do container, inclusive em deploys que não mudaram
# o schema. Falha o container inteiro se a migration falhar (set -e), em vez
# de subir a API contra um schema desatualizado/divergente.
#
# `RUN_MIGRATIONS=false` pula esse passo — útil se as migrations forem
# aplicadas à parte (ex.: um job/console separado no EasyPanel) em vez de a
# cada start do serviço.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Aplicando migrations do Prisma (prisma migrate deploy)..."
  ./node_modules/.bin/prisma migrate deploy --schema=prisma/schema
else
  echo "[entrypoint] RUN_MIGRATIONS=false — pulando prisma migrate deploy."
fi

echo "[entrypoint] Iniciando aplicação..."
exec node dist/src/main.js
