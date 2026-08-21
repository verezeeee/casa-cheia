import { UserRole } from '../enums/user-role.enum';

/**
 * Projeção pública do usuário autenticado, derivada do access token.
 * É o que o frontend guarda em sessão para renderizar UI e checar permissões.
 *
 * Contém apenas dados não sensíveis: nada de hash de senha, chave PIX,
 * documento ou saldo (saldo vem de `WalletBalanceResponse`, sempre fresco).
 * A autorização real é sempre revalidada no backend — `role` aqui serve
 * apenas para esconder/exibir elementos de interface.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}
