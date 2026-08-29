-- ============================================================================
-- CL-DB-03 — ROW-LEVEL SECURITY: isolamento entre clubes
-- ----------------------------------------------------------------------------
-- SQL 100% escrito à mão: RLS não é expresso em Prisma Schema Language, logo
-- `prisma migrate dev` jamais geraria estas linhas e `prisma migrate diff`
-- jamais detectaria a sua ausência. A rede que prova que elas continuam de pé
-- é `apps/backend/test/tenant-isolation.int-spec.ts`.
--
-- ----------------------------------------------------------------------------
-- COMO O CONTEXTO DE TENANT CHEGA AO BANCO
-- ----------------------------------------------------------------------------
-- Toda policy compara `clube_id` com a GUC de sessão `app.current_clube_id`,
-- que a aplicação define no início de cada transação:
--
--   SELECT set_config('app.current_clube_id', $1, true);  -- true = escopo TX
--
-- (Escrever essa chamada é escopo de CL-BE-01 — ver "DEPENDÊNCIA DE RELEASE"
-- no fim deste cabeçalho.)
--
-- `current_setting('app.current_clube_id', true)` — o segundo argumento
-- (`missing_ok`) é OBRIGATÓRIO. Sem ele, uma sessão que não definiu a GUC
-- levanta a exceção 42704 em vez de simplesmente não casar o predicado: cada
-- endpoint sem contexto de clube viraria HTTP 500 em vez de "não encontrado".
-- Com `true`, a ausência da GUC vira NULL, o predicado vira NULL (≠ TRUE) e a
-- linha não passa: FAIL-CLOSED, zero linhas, que é o comportamento correto e
-- também o mais seguro (nunca "aberto por omissão").
--
-- Comparação como TEXTO, sem `::uuid`: os ids do schema são
-- `String @id @default(uuid())`, ou seja, colunas `TEXT` (ver a migration
-- `20260826000000_init_multi_tenant`). `clube_id = current_setting(...)::uuid`
-- falharia já no CREATE POLICY com "operator does not exist: text = uuid".
-- Não há risco de injeção: `set_config` recebe o valor por parâmetro, nunca
-- por interpolação, e um valor malformado apenas não casa com nenhuma linha
-- (fail-closed de novo).
--
-- ----------------------------------------------------------------------------
-- POR QUE `FORCE ROW LEVEL SECURITY`
-- ----------------------------------------------------------------------------
-- `ENABLE` sozinho não vale para o OWNER da tabela — e o owner (`poker`) é
-- justamente quem aplica as migrations. Hoje isso seria inócuo por outro
-- motivo (o runtime conecta como `poker_app`, que não é owner), mas o dia em
-- que alguém apontar a aplicação para `DATABASE_URL` do owner "só para
-- resolver um incidente" o isolamento evaporaria em silêncio. `FORCE` fecha
-- essa porta: nem o dono escapa da policy.
--
-- O que ainda escapa, por desenho do Postgres, é SUPERUSER e roles com
-- BYPASSRLS. No docker-compose e no CI o `poker` É superuser (é o
-- POSTGRES_USER do cluster), então migrations e `prisma db seed` continuam
-- funcionando normalmente. Num ambiente onde o owner NÃO seja superuser, todo
-- backfill de dados terá que definir `app.current_clube_id` ou rodar sob
-- `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` temporário.
--
-- ----------------------------------------------------------------------------
-- TABELAS FILHAS SEM `clube_id` PRÓPRIO — DECISÃO: OPÇÃO (a), COM RESSALVA
-- ----------------------------------------------------------------------------
-- CL-DB-01 decidiu que só a RAIZ de cada agregado carrega `clube_id` (ver o
-- cabeçalho de wallet.prisma): duplicar a coluna nas filhas criaria uma
-- segunda fonte de verdade para o tenant, e com ela a possibilidade de um
-- lançamento apontar para um clube diferente do da sua própria carteira.
--
-- Escolhemos (a) — policy própria com `EXISTS` sobre o pai — e não (b)
-- (confiar na camada de aplicação). Motivos:
--   1. Defesa em profundidade é o princípio que motiva a tarefa inteira. RLS
--      existe para proteger APESAR do bug de aplicação; uma policy que só
--      funciona quando a aplicação já está correta não protege de nada.
--   2. O custo é baixo: todo `EXISTS` aqui é um lookup pela PRIMARY KEY do pai
--      (`w.id = wallet_transactions."walletId"`), não um scan. É um index
--      lookup por linha filtrada, na mesma ordem de grandeza do JOIN que a
--      aplicação já faria.
--   3. Sem policy, `wallet_transactions` seria um extrato financeiro
--      inteiramente legível cross-tenant a partir de um único `WHERE` esquecido
--      — o pior vazamento possível neste domínio.
--
-- RESSALVA (a exceção que um revisor vai perguntar): `pix_charges` e
-- `pix_withdrawals` NÃO recebem policy, e não por preguiça — hoje é
-- estruturalmente impossível. Elas não penduram em nenhum pai escopado: a FK
-- que têm é `userId` (global, o usuário existe acima do clube), e o elo com a
-- carteira é INVERSO (`wallet_transactions.pixChargeId`) e POSTERIOR — a
-- cobrança nasce no pedido do PIX e só ganha um `WalletTransaction` quando o
-- webhook confirma o pagamento. Uma policy via `EXISTS (SELECT 1 FROM
-- wallet_transactions ...)` tornaria toda cobrança recém-criada invisível para
-- quem acabou de criá-la, e o próprio INSERT seria recusado pelo `WITH CHECK`.
-- Escopá-las exige adicionar `clube_id` a essas duas tabelas — mudança de
-- schema, tarefa própria. Até lá o isolamento delas fica na camada de
-- aplicação (opção (b) para essas duas, explicitamente e sob protesto).
--
-- FORA DE ESCOPO POR DESENHO:
--   - `blind_structures` / `blind_levels`: catálogo GLOBAL, sem `clube_id` em
--     nenhum ponto da cadeia (decisão explícita de CL-DB-01). Presets de blind
--     são compartilhados por todos os clubes; o que é do torneio é a cópia por
--     valor em `tournament_blind_levels`, essa sim escopada.
--   - `users` / `refresh_tokens`: identidade é global, o usuário existe antes
--     e acima de qualquer clube.
--   - `webhook_events`: log de infraestrutura do PSP, anterior à resolução de
--     qual clube o evento diz respeito.
--   - `clubes`: a linha do próprio tenant precisa ser legível ANTES de existir
--     contexto (é ela que o resolve). O que é sensível ali é a LISTA, filtrada
--     por `clube_memberships`.
--
-- ATENÇÃO para CL-BE-01: `clube_memberships` recebe policy, então a consulta
-- do SELETOR DE CLUBE ("de quais clubes eu sou membro?") retorna zero linhas
-- sob RLS — ela roda justamente ANTES de haver um clube corrente. Esse caminho
-- precisa de uma conexão sem tenant (ou de uma policy adicional por usuário);
-- não é bug desta migration, é requisito da que vem.
--
-- ----------------------------------------------------------------------------
-- DEPENDÊNCIA DE RELEASE (NÃO É UM COMMIT ISOLADO)
-- ----------------------------------------------------------------------------
-- Enquanto CL-BE-01 não mesclar, NENHUMA transação da aplicação define
-- `app.current_clube_id`. Logo, uma aplicação conectada como `poker_app`
-- enxerga ZERO linhas em todas as tabelas abaixo. Hoje isso é inofensivo
-- porque o runtime ainda usa `DATABASE_URL` (owner `poker`, superuser, que
-- ignora RLS) — `DATABASE_URL_APP` está provisionada mas não é consumida por
-- nenhum código. A troca do runtime para `poker_app` só pode acontecer DEPOIS
-- de CL-BE-01. Esta migration e aquela formam um trem de release.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabelas com `clube_id` PRÓPRIO — predicado direto.
-- ----------------------------------------------------------------------------
-- `WITH CHECK` além de `USING` em todas: `USING` filtra o que a transação
-- ENXERGA (SELECT/UPDATE/DELETE), `WITH CHECK` valida o que ela GRAVA. Sem
-- `WITH CHECK`, um INSERT com `clube_id` de outro tenant passaria — a linha
-- ficaria invisível para quem a criou, mas plantada no clube alheio.

ALTER TABLE "clube_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clube_memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clube_memberships_clube_isolation" ON "clube_memberships"
  USING ("clube_id" = current_setting('app.current_clube_id', true))
  WITH CHECK ("clube_id" = current_setting('app.current_clube_id', true));

ALTER TABLE "clube_payment_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clube_payment_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clube_payment_accounts_clube_isolation" ON "clube_payment_accounts"
  USING ("clube_id" = current_setting('app.current_clube_id', true))
  WITH CHECK ("clube_id" = current_setting('app.current_clube_id', true));

ALTER TABLE "tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tables" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tables_clube_isolation" ON "tables"
  USING ("clube_id" = current_setting('app.current_clube_id', true))
  WITH CHECK ("clube_id" = current_setting('app.current_clube_id', true));

ALTER TABLE "table_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "table_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "table_sessions_clube_isolation" ON "table_sessions"
  USING ("clube_id" = current_setting('app.current_clube_id', true))
  WITH CHECK ("clube_id" = current_setting('app.current_clube_id', true));

ALTER TABLE "tournaments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournaments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tournaments_clube_isolation" ON "tournaments"
  USING ("clube_id" = current_setting('app.current_clube_id', true))
  WITH CHECK ("clube_id" = current_setting('app.current_clube_id', true));

ALTER TABLE "tournament_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tournament_entries_clube_isolation" ON "tournament_entries"
  USING ("clube_id" = current_setting('app.current_clube_id', true))
  WITH CHECK ("clube_id" = current_setting('app.current_clube_id', true));

ALTER TABLE "wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "wallets_clube_isolation" ON "wallets"
  USING ("clube_id" = current_setting('app.current_clube_id', true))
  WITH CHECK ("clube_id" = current_setting('app.current_clube_id', true));

-- ----------------------------------------------------------------------------
-- 2. Tabelas filhas — escopo herdado por `EXISTS` sobre a raiz do agregado.
-- ----------------------------------------------------------------------------
-- O `EXISTS` é sempre um lookup pela PK do pai. A subconsulta também roda sob
-- RLS (o pai já está protegido), então a condição de `clube_id` nela é
-- redundante de propósito: mantém a policy correta por si só, caso a do pai
-- seja um dia alterada.

ALTER TABLE "wallet_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "wallet_transactions_clube_isolation" ON "wallet_transactions"
  USING (EXISTS (
    SELECT 1 FROM "wallets" w
     WHERE w."id" = "wallet_transactions"."walletId"
       AND w."clube_id" = current_setting('app.current_clube_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "wallets" w
     WHERE w."id" = "wallet_transactions"."walletId"
       AND w."clube_id" = current_setting('app.current_clube_id', true)));

ALTER TABLE "stack_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stack_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "stack_movements_clube_isolation" ON "stack_movements"
  USING (EXISTS (
    SELECT 1 FROM "table_sessions" s
     WHERE s."id" = "stack_movements"."table_session_id"
       AND s."clube_id" = current_setting('app.current_clube_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "table_sessions" s
     WHERE s."id" = "stack_movements"."table_session_id"
       AND s."clube_id" = current_setting('app.current_clube_id', true)));

ALTER TABLE "tournament_tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_tables" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tournament_tables_clube_isolation" ON "tournament_tables"
  USING (EXISTS (
    SELECT 1 FROM "tournaments" t
     WHERE t."id" = "tournament_tables"."tournament_id"
       AND t."clube_id" = current_setting('app.current_clube_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "tournaments" t
     WHERE t."id" = "tournament_tables"."tournament_id"
       AND t."clube_id" = current_setting('app.current_clube_id', true)));

ALTER TABLE "tournament_blind_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_blind_levels" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tournament_blind_levels_clube_isolation" ON "tournament_blind_levels"
  USING (EXISTS (
    SELECT 1 FROM "tournaments" t
     WHERE t."id" = "tournament_blind_levels"."tournament_id"
       AND t."clube_id" = current_setting('app.current_clube_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "tournaments" t
     WHERE t."id" = "tournament_blind_levels"."tournament_id"
       AND t."clube_id" = current_setting('app.current_clube_id', true)));

ALTER TABLE "tournament_prizes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_prizes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tournament_prizes_clube_isolation" ON "tournament_prizes"
  USING (EXISTS (
    SELECT 1 FROM "tournaments" t
     WHERE t."id" = "tournament_prizes"."tournament_id"
       AND t."clube_id" = current_setting('app.current_clube_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "tournaments" t
     WHERE t."id" = "tournament_prizes"."tournament_id"
       AND t."clube_id" = current_setting('app.current_clube_id', true)));

-- `tournament_seats` pendura em DOIS pais (`tournament_tables` e
-- `tournament_entries`); o predicado usa `tournament_entries` porque ela tem
-- `clube_id` PRÓPRIO — um único lookup por PK, contra os dois que a rota por
-- `tournament_tables` exigiria (mesa -> torneio).
ALTER TABLE "tournament_seats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_seats" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tournament_seats_clube_isolation" ON "tournament_seats"
  USING (EXISTS (
    SELECT 1 FROM "tournament_entries" e
     WHERE e."id" = "tournament_seats"."tournament_entry_id"
       AND e."clube_id" = current_setting('app.current_clube_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "tournament_entries" e
     WHERE e."id" = "tournament_seats"."tournament_entry_id"
       AND e."clube_id" = current_setting('app.current_clube_id', true)));
