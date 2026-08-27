-- CreateEnum
CREATE TYPE "TournamentClockStatus" AS ENUM ('NOT_STARTED', 'RUNNING', 'PAUSED', 'FINISHED');

-- CreateEnum
CREATE TYPE "TournamentTableStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TournamentSeatReason" AS ENUM ('INITIAL', 'BALANCE', 'BREAK', 'MANUAL_REDRAW');

-- DropIndex
-- Reentry entra no escopo do MVP (decisão MT-000, rota (a)): o mesmo jogador
-- pode ter VÁRIAS inscrições no mesmo torneio ao longo do tempo, desde que no
-- máximo UMA esteja viva. O unique total impedia isso; ele é substituído pelo
-- índice único PARCIAL `tournament_entries_active_user_unique` no fim deste
-- arquivo — mesmo padrão de `table_sessions_active_user_unique`.
DROP INDEX "tournament_entries_tournament_id_user_id_key";

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "allow_reentry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blind_structure_id" TEXT,
ADD COLUMN     "clock_remaining_ms" INTEGER,
ADD COLUMN     "clock_status" "TournamentClockStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "current_level_number" INTEGER,
ADD COLUMN     "level_ends_at" TIMESTAMP(3),
ADD COLUMN     "max_reentries" INTEGER,
ADD COLUMN     "reentry_until_level" INTEGER;

-- CreateTable
CREATE TABLE "blind_structures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blind_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blind_levels" (
    "id" TEXT NOT NULL,
    "blind_structure_id" TEXT NOT NULL,
    "level_number" INTEGER NOT NULL,
    "small_blind" INTEGER NOT NULL,
    "big_blind" INTEGER NOT NULL,
    "ante" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER NOT NULL,
    "is_break" BOOLEAN NOT NULL DEFAULT false,
    "break_label" TEXT,

    CONSTRAINT "blind_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_blind_levels" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "level_number" INTEGER NOT NULL,
    "small_blind" INTEGER NOT NULL,
    "big_blind" INTEGER NOT NULL,
    "ante" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER NOT NULL,
    "is_break" BOOLEAN NOT NULL DEFAULT false,
    "break_label" TEXT,

    CONSTRAINT "tournament_blind_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_tables" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "table_number" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "TournamentTableStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_seats" (
    "id" TEXT NOT NULL,
    "tournament_table_id" TEXT NOT NULL,
    "tournament_entry_id" TEXT NOT NULL,
    "seat_number" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" "TournamentSeatReason" NOT NULL,
    "from_table_id" TEXT,
    "from_seat_number" INTEGER,
    "moved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "tournament_seats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blind_structures_created_by_id_idx" ON "blind_structures"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "blind_levels_blind_structure_id_level_number_key" ON "blind_levels"("blind_structure_id", "level_number");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_blind_levels_tournament_id_level_number_key" ON "tournament_blind_levels"("tournament_id", "level_number");

-- CreateIndex
CREATE INDEX "tournament_tables_tournament_id_status_idx" ON "tournament_tables"("tournament_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_tables_tournament_id_table_number_key" ON "tournament_tables"("tournament_id", "table_number");

-- CreateIndex
CREATE INDEX "tournament_seats_tournament_table_id_active_idx" ON "tournament_seats"("tournament_table_id", "active");

-- CreateIndex
CREATE INDEX "tournament_seats_tournament_entry_id_created_at_idx" ON "tournament_seats"("tournament_entry_id", "created_at");

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_blind_structure_id_fkey" FOREIGN KEY ("blind_structure_id") REFERENCES "blind_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blind_structures" ADD CONSTRAINT "blind_structures_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blind_levels" ADD CONSTRAINT "blind_levels_blind_structure_id_fkey" FOREIGN KEY ("blind_structure_id") REFERENCES "blind_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_blind_levels" ADD CONSTRAINT "tournament_blind_levels_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_tables" ADD CONSTRAINT "tournament_tables_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_tournament_table_id_fkey" FOREIGN KEY ("tournament_table_id") REFERENCES "tournament_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_tournament_entry_id_fkey" FOREIGN KEY ("tournament_entry_id") REFERENCES "tournament_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_from_table_id_fkey" FOREIGN KEY ("from_table_id") REFERENCES "tournament_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_moved_by_id_fkey" FOREIGN KEY ("moved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- SQL ESCRITO À MÃO (MT-DB-05 / MT-DB-06)
-- O Prisma Schema Language não expressa `CHECK` nem `UNIQUE ... WHERE`; tudo
-- abaixo é a última barreira de integridade das mesas de torneio, no mesmo
-- estilo do bloco final de `20260821013117_init_schema_integration`.
-- ============================================================================

-- UniqueIndex (parcial)
-- Um assento tem no máximo UMA ocupação ativa. Parcial (e não `@@unique` do
-- Prisma) porque `tournament_seats` é APPEND-ONLY: um índice total incluiria
-- as linhas históricas e impediria um jogador de voltar a um assento que já
-- ocupou depois de um rebalanceamento ou redraw.
CREATE UNIQUE INDEX "tournament_seats_active_seat_unique" ON "tournament_seats"("tournament_table_id", "seat_number") WHERE "active";

-- UniqueIndex (parcial)
-- Uma inscrição tem no máximo UM assento ativo — "ninguém em duas mesas ao
-- mesmo tempo". Mesmo raciocínio de parcialidade acima.
CREATE UNIQUE INDEX "tournament_seats_active_entry_unique" ON "tournament_seats"("tournament_entry_id") WHERE "active";

-- UniqueIndex (parcial)
-- Reentry (MT-DB-06): várias inscrições do mesmo jogador no mesmo torneio são
-- legítimas, DUAS VIVAS ao mesmo tempo não são. A corrida entre dois cliques
-- simultâneos morre aqui, no banco, e não na aplicação.
CREATE UNIQUE INDEX "tournament_entries_active_user_unique" ON "tournament_entries"("tournament_id", "user_id") WHERE "status" IN ('REGISTERED', 'PLAYING');

-- CheckConstraint
-- Mesmo intervalo de `tables.max_seats`: poker exige no mínimo 2 jogadores e
-- full-ring comporta no máximo 10. O teto também limita
-- `tournament_seats.seat_number`.
ALTER TABLE "tournament_tables" ADD CONSTRAINT "tournament_tables_capacity_valid" CHECK ("capacity" BETWEEN 2 AND 10);

-- CheckConstraint
-- Assento é 1-based. O teto depende de outra linha (`capacity` da mesa) e um
-- `CHECK` só enxerga a própria linha — fica com a aplicação.
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_seat_number_positive" CHECK ("seat_number" >= 1);

-- CheckConstraint
-- Nível de blind coerente: SB positivo, BB nunca menor que SB, ante não
-- negativo e duração positiva (duração 0 travaria o relógio no nível).
ALTER TABLE "blind_levels" ADD CONSTRAINT "blind_levels_blinds_valid" CHECK ("small_blind" > 0 AND "big_blind" >= "small_blind" AND "ante" >= 0 AND "duration_seconds" > 0);

-- CheckConstraint
-- Mesma regra na CÓPIA POR VALOR dentro do torneio: os níveis do torneio são
-- editáveis em pleno jogo (MT-BE-07) e precisam da mesma barreira.
ALTER TABLE "tournament_blind_levels" ADD CONSTRAINT "tournament_blind_levels_blinds_valid" CHECK ("small_blind" > 0 AND "big_blind" >= "small_blind" AND "ante" >= 0 AND "duration_seconds" > 0);

-- CheckConstraint
-- Coerência do relógio (MT-DB-03): RUNNING sem `level_ends_at` é um relógio
-- que não sabe quando o nível acaba; PAUSED sem `clock_remaining_ms` perde o
-- tempo restante e o nível "recomeça" ao retomar. NOT_STARTED e FINISHED não
-- têm exigência — nenhum nível está correndo.
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_clock_state_coherent" CHECK (
  ("clock_status" = 'RUNNING' AND "level_ends_at" IS NOT NULL AND "clock_remaining_ms" IS NULL)
  OR ("clock_status" = 'PAUSED' AND "clock_remaining_ms" IS NOT NULL)
  OR ("clock_status" IN ('NOT_STARTED', 'FINISHED'))
);

