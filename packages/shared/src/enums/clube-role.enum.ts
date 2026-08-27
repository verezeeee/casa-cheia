/**
 * Papel de um usuário DENTRO de um clube.
 *
 * - ADMIN: administra o clube (mesas, torneios, membros, configuração).
 * - CASHIER: opera o caixa — depósitos, saques e ajustes de carteira.
 * - TOURNAMENT_DIRECTOR: conduz torneios (relógio, mesas, redraw).
 * - PLAYER: joga. É o papel padrão de todo novo vínculo.
 *
 * SUBSTITUI O ANTIGO `UserRole`, que era atributo do usuário e presumia um
 * único clube. A mesma pessoa pode ser ADMIN de um clube e PLAYER de outro ao
 * mesmo tempo — papel é propriedade da ARESTA usuário↔clube
 * (`ClubeMembership.role`), não do usuário.
 *
 * Não existe papel de staff de plataforma (ADR-0003): o onboarding de clube é
 * curadoria manual, feita fora do produto.
 *
 * Espelha 1:1 (mesmos literais, mesma ordem) `ClubeRole` do schema Prisma.
 */
export enum ClubeRole {
  ADMIN = 'ADMIN',
  CASHIER = 'CASHIER',
  TOURNAMENT_DIRECTOR = 'TOURNAMENT_DIRECTOR',
  PLAYER = 'PLAYER',
}
