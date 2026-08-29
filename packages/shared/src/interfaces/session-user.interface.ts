/**
 * Projeção pública do usuário autenticado, derivada do access token.
 * É o que o frontend guarda em sessão para renderizar UI.
 *
 * Contém apenas dados não sensíveis: nada de hash de senha, chave PIX,
 * documento ou saldo (saldo vem de `WalletBalanceResponse`, sempre fresco).
 *
 * MULTI-TENANT (CL-DB-01 → CL-BE-03)
 * `role` FOI REMOVIDO daqui. Papel é propriedade do vínculo usuário↔clube
 * (`ClubeMembership.role`), então só existe RELATIVO A UM CLUBE — a mesma
 * pessoa pode ser `ADMIN` do clube A e `PLAYER` do clube B. Um campo único na
 * sessão não tem como expressar isso e daria a UI errada no clube errado.
 * O papel do clube corrente virá de um contrato próprio de membership
 * (`GET /clubes` / `GET /clubes/:clubeId`), não deste tipo.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
}
