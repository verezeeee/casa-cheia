-- ============================================================================
-- CL-BE-07 — fecha a lacuna de RLS que CL-DB-03 deixou documentada para
-- `pix_charges`/`pix_withdrawals` (migration `20260829000000_rls_clube_isolation`).
-- ----------------------------------------------------------------------------
-- Aquela migration explicava por que as duas tabelas ficaram de fora: não
-- penduravam em nenhum pai escopado por clube, então nem um predicado direto
-- (não tinham `clube_id` próprio) nem um `EXISTS` sobre o pai (o elo com a
-- wallet é inverso e posterior — só nasce quando o webhook confirma o
-- pagamento) eram possíveis. A migration anterior nesta mesma tarefa
-- (`20260829044645_add_clube_id_pix`) adicionou `clube_id NOT NULL` a ambas;
-- agora a policy é um predicado direto, IDÊNTICO ao de `wallets` — mesmo
-- `USING`/`WITH CHECK`, mesma comparação como TEXTO (os ids do schema são
-- `String @id @default(uuid())`, isto é, colunas TEXT — nunca `::uuid`, pelo
-- mesmo motivo documentado na migration de RLS original), mesmo `FORCE ROW
-- LEVEL SECURITY` (fecha a porta até para o owner das migrations).
-- ============================================================================

ALTER TABLE "pix_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pix_charges" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pix_charges_clube_isolation" ON "pix_charges"
  USING ("clube_id" = current_setting('app.current_clube_id', true))
  WITH CHECK ("clube_id" = current_setting('app.current_clube_id', true));

ALTER TABLE "pix_withdrawals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pix_withdrawals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pix_withdrawals_clube_isolation" ON "pix_withdrawals"
  USING ("clube_id" = current_setting('app.current_clube_id', true))
  WITH CHECK ("clube_id" = current_setting('app.current_clube_id', true));
