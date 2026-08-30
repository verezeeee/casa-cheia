import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ClubeMembershipStatus,
  ClubeOnboardingStatus,
  ClubeRole,
  ClubeStatus,
  PixChargeStatus,
  PixWithdrawalStatus,
  TableSessionStatus,
  TableStatus,
  TableType,
  TournamentClockStatus,
  TournamentEntryStatus,
  TournamentSeatReason,
  TournamentStatus,
  TournamentTableStatus,
  WalletTransactionStatus,
  WalletTransactionType,
} from './index';
import type {
  AuthTokensResponse,
  BlindLevelDto,
  BlindStructureDto,
  ClubeMembershipDto,
  ClubeSummaryDto,
  MoneyString,
  PaginatedResponse,
  PixChargeResponse,
  PixWithdrawalResponse,
  SessionUser,
  TableSeatDto,
  TableSummaryDto,
  TournamentClockDto,
  TournamentEntryDto,
  TournamentSeatDto,
  TournamentSummaryDto,
  TournamentTableDto,
  TournamentTableMapDto,
  WalletBalanceResponse,
  WalletTransactionDto,
} from './index';

/**
 * Este spec cobre duas coisas:
 * 1. Runtime: os enums são realmente exportados pelo barrel e seus literais
 *    batem 1:1 com os enums do schema Prisma (contrato fechado da onda W1).
 *    Um rename acidental de literal quebra o mapeamento backend <-> banco.
 * 2. Compile-time: as interfaces são importáveis como tipos e os campos
 *    monetários só aceitam string (`MoneyString`). Os `@ts-expect-error`
 *    falham o build se alguém trocar um campo de dinheiro por `number`.
 */

/** Confere que o enum tem exatamente as chaves esperadas e chave === valor. */
function assertEnumLiterals(enumObject: Record<string, string>, expectedKeys: string[]): void {
  assert.deepEqual(Object.keys(enumObject).sort(), [...expectedKeys].sort());

  for (const key of expectedKeys) {
    assert.equal(enumObject[key], key, `esperado ${key} === '${key}'`);
  }
}

describe('@poker-system/shared barrel export', () => {
  describe('enums pré-existentes (não podem regredir)', () => {
    it('exporta TableType', () => {
      assertEnumLiterals(TableType, ['CASH_GAME', 'TOURNAMENT']);
    });

    it('exporta WalletTransactionType', () => {
      assertEnumLiterals(WalletTransactionType, [
        'PIX_DEPOSIT',
        'PIX_WITHDRAWAL',
        'TABLE_BUY_IN',
        'TABLE_CASH_OUT',
        'TOURNAMENT_BUY_IN',
        'TOURNAMENT_PAYOUT',
        'ADJUSTMENT',
      ]);
    });
  });

  describe('novos enums de estado', () => {
    it('exporta WalletTransactionStatus', () => {
      assertEnumLiterals(WalletTransactionStatus, ['PENDING', 'COMPLETED', 'FAILED', 'REVERSED']);
    });

    it('exporta PixChargeStatus', () => {
      assertEnumLiterals(PixChargeStatus, ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED']);
    });

    it('exporta PixWithdrawalStatus', () => {
      assertEnumLiterals(PixWithdrawalStatus, ['REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED']);
    });

    it('exporta TableStatus', () => {
      assertEnumLiterals(TableStatus, ['OPEN', 'PAUSED', 'CLOSED']);
    });

    it('exporta TableSessionStatus', () => {
      assertEnumLiterals(TableSessionStatus, ['ACTIVE', 'CASHED_OUT']);
    });

    it('exporta TournamentStatus', () => {
      assertEnumLiterals(TournamentStatus, [
        'DRAFT',
        'REGISTERING',
        'RUNNING',
        'FINISHED',
        'CANCELLED',
      ]);
    });

    it('exporta TournamentEntryStatus', () => {
      assertEnumLiterals(TournamentEntryStatus, [
        'REGISTERED',
        'PLAYING',
        'ELIMINATED',
        'PAID',
        'REFUNDED',
      ]);
    });
  });

  describe('enums de mesas de torneio (MT-SH-01)', () => {
    it('exporta TournamentClockStatus', () => {
      assertEnumLiterals(TournamentClockStatus, ['NOT_STARTED', 'RUNNING', 'PAUSED', 'FINISHED']);
    });

    it('exporta TournamentTableStatus', () => {
      assertEnumLiterals(TournamentTableStatus, ['OPEN', 'CLOSED']);
    });

    it('exporta TournamentSeatReason', () => {
      assertEnumLiterals(TournamentSeatReason, ['INITIAL', 'BALANCE', 'BREAK', 'MANUAL_REDRAW']);
    });
  });

  describe('enums do multi-tenant Clube (CL-DB-01)', () => {
    it('exporta ClubeStatus', () => {
      assertEnumLiterals(ClubeStatus, ['ACTIVE', 'SUSPENDED', 'CANCELLED']);
    });

    it('exporta ClubeRole', () => {
      assertEnumLiterals(ClubeRole, ['ADMIN', 'CASHIER', 'TOURNAMENT_DIRECTOR', 'PLAYER']);
    });

    it('exporta ClubeMembershipStatus', () => {
      assertEnumLiterals(ClubeMembershipStatus, ['ACTIVE', 'REVOKED']);
    });

    it('exporta ClubeOnboardingStatus', () => {
      assertEnumLiterals(ClubeOnboardingStatus, ['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED']);
    });

    // `UserRole` foi REMOVIDO nesta onda (papel virou propriedade do vínculo
    // usuário↔clube). Se alguém o reintroduzir, o barrel volta a ter duas
    // fontes de verdade para papel — este teste falha antes disso acontecer.
    it('não exporta mais UserRole', async () => {
      const barrel: Record<string, unknown> = await import('./index');

      assert.equal(barrel.UserRole, undefined);
    });
  });

  describe('contratos de tipo (validados em tempo de compilação)', () => {
    it('aceita objetos que satisfazem as interfaces exportadas', () => {
      const money: MoneyString = '1250.00';

      const tokens: AuthTokensResponse = { accessToken: 'jwt', expiresIn: 900 };

      // Sem `role`: papel é do vínculo usuário↔clube, não do usuário (CL-BE-03).
      const sessionUser: SessionUser = {
        id: 'usr_1',
        email: 'player@poker.dev',
        name: 'Player One',
      };

      const balance: WalletBalanceResponse = { balance: money, version: 7 };

      const transaction: WalletTransactionDto = {
        id: 'txn_1',
        type: WalletTransactionType.PIX_DEPOSIT,
        status: WalletTransactionStatus.COMPLETED,
        amount: '100.00',
        balanceAfter: '1350.00',
        description: null,
        createdAt: '2026-01-31T12:00:00.000Z',
      };

      const charge: PixChargeResponse = {
        id: 'chg_1',
        amount: '100.00',
        status: PixChargeStatus.PENDING,
        qrCodePayload: '00020126...',
        qrCodeImageUrl: null,
        expiresAt: '2026-01-31T12:30:00.000Z',
      };

      const withdrawal: PixWithdrawalResponse = {
        id: 'wdr_1',
        amount: '50.00',
        status: PixWithdrawalStatus.REQUESTED,
        pixKeyMasked: '***1234',
        failureReason: null,
        createdAt: '2026-01-31T12:00:00.000Z',
      };

      const table: TableSummaryDto = {
        id: 'tbl_1',
        name: 'NL Holdem 1/2',
        type: TableType.CASH_GAME,
        smallBlind: '1.00',
        bigBlind: '2.00',
        minBuyIn: '40.00',
        maxBuyIn: '200.00',
        maxSeats: 9,
        occupiedSeats: 3,
        status: TableStatus.OPEN,
      };

      const emptySeat: TableSeatDto = {
        seatNumber: 4,
        userId: null,
        userName: null,
        currentStack: null,
        sessionId: null,
      };

      const tournament: TournamentSummaryDto = {
        id: 'trn_1',
        name: 'Sunday Major',
        buyIn: '90.00',
        fee: '10.00',
        staffBonusCost: '5.00',
        staffBonusChips: 2_500,
        maxPlayers: 180,
        registeredPlayers: 42,
        status: TournamentStatus.REGISTERING,
        startsAt: '2026-02-01T21:00:00.000Z',
      };

      const entry: TournamentEntryDto = {
        id: 'ent_1',
        userId: sessionUser.id,
        userName: sessionUser.name,
        status: TournamentEntryStatus.PLAYING,
        chipStack: 25_000,
        staffBonusPaid: true,
        finalPosition: null,
        prizeAmount: null,
        tableNumber: 3,
        seatNumber: 7,
      };

      const level: BlindLevelDto = {
        levelNumber: 1,
        smallBlind: 100,
        bigBlind: 200,
        ante: 0,
        durationSeconds: 1_200,
        isBreak: false,
        breakLabel: null,
      };

      const structure: BlindStructureDto = {
        id: 'bls_1',
        name: 'Turbo 20min',
        levels: [level],
      };

      const clock: TournamentClockDto = {
        clockStatus: TournamentClockStatus.RUNNING,
        currentLevel: level,
        nextLevel: null,
        levelEndsAt: '2026-02-01T21:20:00.000Z',
        remainingMs: 1_200_000,
        serverTime: '2026-02-01T21:00:00.000Z',
      };

      const seat: TournamentSeatDto = {
        entryId: entry.id,
        userId: sessionUser.id,
        userName: sessionUser.name,
        seatNumber: 7,
        chipStack: 25_000,
      };

      const tournamentTable: TournamentTableDto = {
        id: 'ttb_1',
        tableNumber: 3,
        capacity: 9,
        status: TournamentTableStatus.OPEN,
        seats: [seat],
      };

      const tableMap: TournamentTableMapDto = {
        tournamentId: tournament.id,
        tables: [tournamentTable],
        playersRemaining: 1,
        averageStack: 25_000,
      };

      // Papel vem do vínculo, não do usuário: o mesmo `sessionUser` é PLAYER
      // aqui e poderia ser ADMIN em outro item da mesma lista.
      const clube: ClubeSummaryDto = {
        id: 'clb_1',
        name: 'Casa Cheia',
        status: ClubeStatus.ACTIVE,
        role: ClubeRole.PLAYER,
      };

      const membership: ClubeMembershipDto = {
        id: 'mbs_1',
        userId: sessionUser.id,
        name: sessionUser.name,
        email: sessionUser.email,
        role: ClubeRole.ADMIN,
        status: ClubeMembershipStatus.ACTIVE,
        createdAt: '2026-01-31T12:00:00.000Z',
      };

      const page: PaginatedResponse<WalletTransactionDto> = {
        items: [transaction],
        nextCursor: null,
      };

      assert.equal(tokens.expiresIn, 900);
      assert.equal(balance.balance, '1250.00');
      assert.equal(charge.qrCodeImageUrl, null);
      assert.equal(withdrawal.pixKeyMasked, '***1234');
      assert.equal(table.occupiedSeats, 3);
      assert.equal(emptySeat.currentStack, null);
      assert.equal(tournament.fee, '10.00');
      assert.equal(entry.chipStack, 25_000);
      assert.equal(entry.tableNumber, 3);
      assert.equal(entry.seatNumber, 7);
      assert.equal(structure.levels[0]?.bigBlind, 200);
      assert.equal(clock.serverTime, '2026-02-01T21:00:00.000Z');
      assert.equal(tableMap.tables[0]?.seats[0]?.entryId, entry.id);
      assert.equal(tableMap.playersRemaining, 1);
      assert.equal(clube.role, ClubeRole.PLAYER);
      assert.equal(membership.status, ClubeMembershipStatus.ACTIVE);
      assert.equal(page.nextCursor, null);
      assert.equal(page.items.length, 1);
    });

    it('rejeita number em campos monetários', () => {
      const invalidBalance = {
        // @ts-expect-error dinheiro é sempre MoneyString (string), nunca number
        balance: 1250.0,
        version: 1,
      } satisfies WalletBalanceResponse;

      const invalidTransaction = {
        id: 'txn_2',
        type: WalletTransactionType.TABLE_BUY_IN,
        status: WalletTransactionStatus.COMPLETED,
        // @ts-expect-error dinheiro é sempre MoneyString (string), nunca number
        amount: -100,
        balanceAfter: '0.00',
        description: null,
        createdAt: '2026-01-31T12:00:00.000Z',
      } satisfies WalletTransactionDto;

      const invalidWithdrawal = {
        id: 'wdr_2',
        // @ts-expect-error dinheiro é sempre MoneyString (string), nunca number
        amount: 50,
        status: PixWithdrawalStatus.REQUESTED,
        pixKeyMasked: '***1234',
        failureReason: null,
        createdAt: '2026-01-31T12:00:00.000Z',
      } satisfies PixWithdrawalResponse;

      // Blind de torneio é FICHA (number), não dinheiro: o erro aqui é o
      // inverso dos anteriores — string onde se espera number.
      const invalidLevel = {
        levelNumber: 1,
        // @ts-expect-error blind de torneio é contagem de fichas (number), nunca MoneyString
        smallBlind: '100.00',
        bigBlind: 200,
        ante: 0,
        durationSeconds: 1_200,
        isBreak: false,
        breakLabel: null,
      } satisfies BlindLevelDto;

      // Os objetos só existem para ancorar os @ts-expect-error acima.
      assert.ok(invalidBalance);
      assert.ok(invalidTransaction);
      assert.ok(invalidWithdrawal);
      assert.ok(invalidLevel);
    });
  });
});
