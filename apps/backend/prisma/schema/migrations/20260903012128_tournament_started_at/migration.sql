-- RT-DB-01 · Hora REAL de início do torneio.
--
-- `starts_at` é o horário AGENDADO (cartaz); `started_at` é o instante em que o
-- torneio efetivamente começou, carimbado pela aplicação (RT-BE-01) no start do
-- relógio de blinds ou na transição REGISTERING -> RUNNING da primeira
-- eliminação — o que vier primeiro. Sem ele, a duração do torneio no relatório
-- mediria o atraso do clube, não o tempo de jogo.

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "started_at" TIMESTAMP(3);

-- SEM BACKFILL, DE PROPÓSITO.
-- Nenhum UPDATE preenche `started_at` dos torneios já encerrados. A opção
-- óbvia (`started_at = starts_at`) inventaria uma duração falsa com cara de
-- verdadeira para todo o histórico. Esses torneios ficam com NULL e o relatório
-- os marca explicitamente como duração ESTIMADA (`durationEstimated = true`).

-- CHECK manual (Prisma Schema Language não expressa CHECK — mesmo padrão de
-- `tournaments_clock_state_coherent` e `tournaments_staff_bonus_coherent`):
-- torneio não pode terminar antes de começar. Os dois `IS NULL` são
-- deliberados, não frouxidão: torneio legado tem `started_at` nulo com
-- `finished_at` preenchido, e torneio em andamento tem o inverso. A regra só
-- morde quando os DOIS carimbos existem.
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_finished_after_started"
  CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at");

-- Nenhum índice novo: `started_at` é coluna de LEITURA do relatório de um
-- torneio já localizado por id, nunca predicado de busca.
