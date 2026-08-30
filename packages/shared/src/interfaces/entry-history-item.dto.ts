import { TableSessionStatus } from '../enums/table-session-status.enum';
import { TournamentEntryStatus } from '../enums/tournament-entry-status.enum';
import { MoneyString } from '../types/money';

export enum EntryHistoryKind {
  TOURNAMENT = 'TOURNAMENT',
  TABLE = 'TABLE',
}

/**
 * Uma linha do histórico de participação de um jogador — inscrição em
 * torneio (`TournamentEntry`) OU sessão de mesa de cash game
 * (`TableSession`), unificadas numa lista só (ver `EntriesService`).
 * Metade dos campos é sempre `null` dependendo de `kind` — mais simples
 * que duas interfaces + union discriminada para o consumo que este DTO tem
 * (lista + modal de detalhe), e evita duplicar `id`/`occurredAt`/`userId`/
 * `userName`/`label`, que são comuns aos dois tipos.
 */
export interface EntryHistoryItemDto {
  kind: EntryHistoryKind;
  id: string;

  /** ISO-8601 — `registeredAt` (torneio) ou `joinedAt` (mesa). */
  occurredAt: string;

  userId: string;
  /** Só exibido no front quando quem vê é ADMIN (o próprio jogador já sabe quem é). */
  userName: string;

  /** Nome do torneio ou da mesa. */
  label: string;

  // --- kind === TOURNAMENT (null quando kind === TABLE) ---------------------
  buyIn: MoneyString | null;
  tournamentStatus: TournamentEntryStatus | null;
  finalPosition: number | null;
  prizeAmount: MoneyString | null;
  chipStack: number | null;

  // --- kind === TABLE (null quando kind === TOURNAMENT) ----------------------
  totalBuyIn: MoneyString | null;
  totalCashOut: MoneyString | null;
  currentStack: MoneyString | null;
  tableStatus: TableSessionStatus | null;
  /**
   * `totalCashOut + currentStack - totalBuyIn` (mesma fórmula do docblock de
   * `TableSession.totalCashOut` no schema) — JÁ CALCULADO no backend (regra
   * de ouro: dinheiro nunca faz aritmética no frontend). Enquanto `ACTIVE`
   * é o resultado corrente (o stack ainda não voltou pra wallet); em
   * `CASHED_OUT`, `currentStack` é sempre 0 e isto vira o resultado final.
   */
  netResult: MoneyString | null;
}
