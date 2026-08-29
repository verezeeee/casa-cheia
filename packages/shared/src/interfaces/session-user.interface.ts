import { ClubeRole } from '../enums/clube-role.enum';

/**
 * Projeção pública do usuário autenticado, derivada do access token.
 * É o que o frontend guarda em sessão para renderizar UI e checar permissões.
 *
 * Contém apenas dados não sensíveis: nada de hash de senha, chave PIX,
 * documento ou saldo (saldo vem de `WalletBalanceResponse`, sempre fresco).
 * A autorização real é sempre revalidada no backend — `role` aqui serve
 * apenas para esconder/exibir elementos de interface.
 *
 * MULTI-TENANT (CL-DB-01 → CL-BE-03)
 * `role` deixou de ser `UserRole` (enum removido) e passou a ser `ClubeRole`:
 * papel é propriedade do vínculo usuário↔clube, não do usuário. Por isso ele
 * só faz sentido RELATIVO A UM CLUBE — o clube corrente da sessão. Amarrar
 * esse clube ao token (campo `clubeId` aqui e claim correspondente no JWT) é
 * trabalho de `CL-BE-03`, que refaz a emissão do access token; esta task só
 * troca o tipo do papel para não deixar um enum órfão para trás.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: ClubeRole;
}
