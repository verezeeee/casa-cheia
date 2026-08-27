/**
 * Assento OCUPADO de uma mesa de torneio.
 *
 * Diferente de `TableSeatDto` (cash game), que também representa assento vago:
 * aqui só existem assentos ocupados — a vacância é derivada de
 * `TournamentTableDto.capacity - seats.length`, porque o assento de torneio não
 * tem sessão nem stack em dinheiro para exibir quando vazio.
 *
 * A identidade é `entryId` e não `userId`: com reentry, o mesmo jogador pode ter
 * mais de uma inscrição no mesmo torneio, e o assento pertence à INSCRIÇÃO.
 *
 * FRONTEIRA DE CONFIANÇA: o endpoint público de TV (MT-BE-08) não pode expor
 * `userId` — usa um tipo derivado (`Omit<TournamentSeatDto, 'userId'>`), não
 * este DTO cru.
 */
export interface TournamentSeatDto {
  /** Id da `TournamentEntry` sentada. */
  entryId: string;

  userId: string;

  userName: string;

  /** Posição do assento na mesa (1-based). */
  seatNumber: number;

  /** Fichas de torneio (sem valor monetário). */
  chipStack: number;
}
