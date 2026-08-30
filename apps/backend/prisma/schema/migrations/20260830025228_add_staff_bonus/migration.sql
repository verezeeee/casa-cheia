-- AlterTable
ALTER TABLE "tournament_entries" ADD COLUMN     "staff_bonus_paid" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "staff_bonus_chips" INTEGER,
ADD COLUMN     "staff_bonus_cost" DECIMAL(14,2);

-- CHECK manual (Prisma Schema Language não expressa CHECK): custo e fichas do
-- bônus de staff andam juntos — um sem o outro não faz sentido. Mesmo padrão
-- de `tournaments_clock_state_coherent` (migration `init_multi_tenant`).
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_staff_bonus_coherent" CHECK (
  ("staff_bonus_cost" IS NULL) = ("staff_bonus_chips" IS NULL)
);
