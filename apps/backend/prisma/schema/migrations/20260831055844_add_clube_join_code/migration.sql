-- Código curto de ingresso (6 dígitos) do clube. Escrita à mão (não gerada
-- por `prisma migrate dev`) porque a coluna precisa nascer NOT NULL + UNIQUE
-- numa tabela que já tem linhas em produção — backfill em 3 passos, nunca um
-- ADD COLUMN NOT NULL direto (quebraria contra qualquer linha existente).
ALTER TABLE "clubes" ADD COLUMN "join_code" TEXT;

UPDATE "clubes"
SET "join_code" = lpad((floor(random() * 900000) + 100000)::text, 6, '0')
WHERE "join_code" IS NULL;

ALTER TABLE "clubes" ALTER COLUMN "join_code" SET NOT NULL;

ALTER TABLE "clubes" ADD CONSTRAINT "clubes_join_code_key" UNIQUE ("join_code");
