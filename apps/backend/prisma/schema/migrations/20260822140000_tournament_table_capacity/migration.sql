-- AlterTable
-- Capacidade padrão das mesas do torneio (MT-BE-03). `DEFAULT 9` cobre os
-- torneios já existentes (full-ring), então a coluna nasce NOT NULL sem
-- backfill manual.
ALTER TABLE "tournaments" ADD COLUMN     "table_capacity" INTEGER NOT NULL DEFAULT 9;

-- CheckConstraint
-- Mesmo intervalo de `tournament_tables.capacity`: o valor daqui é copiado
-- para toda mesa aberta, e um torneio com capacidade inválida só falharia lá
-- na frente, na primeira inscrição.
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_table_capacity_valid" CHECK ("table_capacity" BETWEEN 2 AND 10);
