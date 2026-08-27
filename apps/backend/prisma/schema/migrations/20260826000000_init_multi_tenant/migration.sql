-- ============================================================================
-- CL-DB-01 — SQUASH: schema inicial já multi-tenant ("Clube")
-- ----------------------------------------------------------------------------
-- Esta migration SUBSTITUI as três anteriores, que foram removidas:
--   20260821013117_init_schema_integration
--   20260822120000_tournament_tables_and_blinds
--   20260822140000_tournament_table_capacity
--
-- O squash é possível porque não há dado real em produção hoje — logo, não há
-- backfill: `clube_id` nasce NOT NULL sem `DEFAULT`, como deve ser um
-- discriminador de tenant. Aplicar a partir daqui é sempre um banco vazio.
--
-- O bloco final ("SQL ESCRITO À MÃO") reproduz na íntegra os `CHECK` e os
-- índices únicos PARCIAIS das três migrations originais. Eles não vêm do
-- Prisma Schema Language e se perderiam silenciosamente num squash
-- descuidado; `apps/backend/test/schema-invariants.int-spec.ts` é a rede que
-- prova, contra Postgres real, que cada um deles continua de pé.
-- ============================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ClubeStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClubeRole" AS ENUM ('ADMIN', 'CASHIER', 'TOURNAMENT_DIRECTOR', 'PLAYER');

-- CreateEnum
CREATE TYPE "ClubeMembershipStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ClubeOnboardingStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TableType" AS ENUM ('CASH_GAME', 'TOURNAMENT');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('PIX_DEPOSIT', 'PIX_WITHDRAWAL', 'TABLE_BUY_IN', 'TABLE_CASH_OUT', 'TOURNAMENT_BUY_IN', 'TOURNAMENT_PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WalletTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PixChargeStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PixWithdrawalStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TableSessionStatus" AS ENUM ('ACTIVE', 'CASHED_OUT');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTERING', 'RUNNING', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentEntryStatus" AS ENUM ('REGISTERED', 'PLAYING', 'ELIMINATED', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TournamentClockStatus" AS ENUM ('NOT_STARTED', 'RUNNING', 'PAUSED', 'FINISHED');

-- CreateEnum
CREATE TYPE "TournamentTableStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TournamentSeatReason" AS ENUM ('INITIAL', 'BALANCE', 'BREAK', 'MANUAL_REDRAW');

-- CreateEnum
CREATE TYPE "StackMovementReason" AS ENUM ('BUY_IN', 'CASH_OUT', 'HAND_RESULT', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "clubes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "status" "ClubeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clubes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clube_memberships" (
    "id" TEXT NOT NULL,
    "clube_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "ClubeRole" NOT NULL DEFAULT 'PLAYER',
    "status" "ClubeMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clube_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clube_payment_accounts" (
    "id" TEXT NOT NULL,
    "clube_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "onboarding_status" "ClubeOnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "raw_onboarding_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clube_payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "email_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_token_id" TEXT,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" TEXT NOT NULL,
    "clube_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TableType" NOT NULL,
    "small_blind" DECIMAL(14,2) NOT NULL,
    "big_blind" DECIMAL(14,2) NOT NULL,
    "min_buy_in" DECIMAL(14,2) NOT NULL,
    "max_buy_in" DECIMAL(14,2) NOT NULL,
    "max_seats" INTEGER NOT NULL,
    "status" "TableStatus" NOT NULL,
    "rake_percent" DECIMAL(5,2),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_sessions" (
    "id" TEXT NOT NULL,
    "clube_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "seat_number" INTEGER NOT NULL,
    "status" "TableSessionStatus" NOT NULL,
    "current_stack" DECIMAL(14,2) NOT NULL,
    "total_buy_in" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_cash_out" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "table_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stack_movements" (
    "id" TEXT NOT NULL,
    "table_session_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" "StackMovementReason" NOT NULL,
    "stack_after" DECIMAL(14,2) NOT NULL,
    "wallet_transaction_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stack_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL,
    "clube_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buy_in" DECIMAL(14,2) NOT NULL,
    "fee" DECIMAL(14,2) NOT NULL,
    "starting_stack" INTEGER NOT NULL,
    "max_players" INTEGER NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "registration_opens_at" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3) NOT NULL,
    "late_reg_until" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "prize_pool" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "guaranteed_prize" DECIMAL(14,2),
    "blind_structure_id" TEXT,
    "clock_status" "TournamentClockStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "current_level_number" INTEGER,
    "level_ends_at" TIMESTAMP(3),
    "clock_remaining_ms" INTEGER,
    "table_capacity" INTEGER NOT NULL DEFAULT 9,
    "allow_reentry" BOOLEAN NOT NULL DEFAULT false,
    "max_reentries" INTEGER,
    "reentry_until_level" INTEGER,
    "created_by_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_prizes" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "tournament_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_entries" (
    "id" TEXT NOT NULL,
    "clube_id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "TournamentEntryStatus" NOT NULL DEFAULT 'REGISTERED',
    "chip_stack" INTEGER NOT NULL,
    "final_position" INTEGER,
    "prize_amount" DECIMAL(14,2),
    "buy_in_transaction_id" TEXT,
    "payout_transaction_id" TEXT,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminated_at" TIMESTAMP(3),

    CONSTRAINT "tournament_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blind_structures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blind_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blind_levels" (
    "id" TEXT NOT NULL,
    "blind_structure_id" TEXT NOT NULL,
    "level_number" INTEGER NOT NULL,
    "small_blind" INTEGER NOT NULL,
    "big_blind" INTEGER NOT NULL,
    "ante" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER NOT NULL,
    "is_break" BOOLEAN NOT NULL DEFAULT false,
    "break_label" TEXT,

    CONSTRAINT "blind_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_blind_levels" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "level_number" INTEGER NOT NULL,
    "small_blind" INTEGER NOT NULL,
    "big_blind" INTEGER NOT NULL,
    "ante" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER NOT NULL,
    "is_break" BOOLEAN NOT NULL DEFAULT false,
    "break_label" TEXT,

    CONSTRAINT "tournament_blind_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_tables" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "table_number" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "TournamentTableStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_seats" (
    "id" TEXT NOT NULL,
    "tournament_table_id" TEXT NOT NULL,
    "tournament_entry_id" TEXT NOT NULL,
    "seat_number" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" "TournamentSeatReason" NOT NULL,
    "from_table_id" TEXT,
    "from_seat_number" INTEGER,
    "moved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "tournament_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "clube_id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "status" "WalletTransactionStatus" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT,
    "pixChargeId" TEXT,
    "pixWithdrawalId" TEXT,
    "tableSessionId" TEXT,
    "tournamentEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pix_charges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "PixChargeStatus" NOT NULL,
    "qrCodePayload" TEXT NOT NULL,
    "qrCodeImageUrl" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pix_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pix_withdrawals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "pixKey" TEXT NOT NULL,
    "pixKeyType" TEXT NOT NULL,
    "status" "PixWithdrawalStatus" NOT NULL,
    "failureReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pix_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clubes_document_key" ON "clubes"("document");

-- CreateIndex
CREATE INDEX "clube_memberships_user_id_idx" ON "clube_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "clube_memberships_clube_id_user_id_key" ON "clube_memberships"("clube_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "clube_payment_accounts_clube_id_key" ON "clube_payment_accounts"("clube_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_document_key" ON "users"("document");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "tables_clube_id_status_type_idx" ON "tables"("clube_id", "status", "type");

-- CreateIndex
CREATE INDEX "tables_created_by_id_idx" ON "tables"("created_by_id");

-- CreateIndex
CREATE INDEX "table_sessions_table_id_status_idx" ON "table_sessions"("table_id", "status");

-- CreateIndex
CREATE INDEX "table_sessions_user_id_status_idx" ON "table_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "table_sessions_clube_id_idx" ON "table_sessions"("clube_id");

-- CreateIndex
CREATE INDEX "stack_movements_table_session_id_created_at_idx" ON "stack_movements"("table_session_id", "created_at");

-- CreateIndex
CREATE INDEX "stack_movements_wallet_transaction_id_idx" ON "stack_movements"("wallet_transaction_id");

-- CreateIndex
CREATE INDEX "tournaments_clube_id_status_starts_at_idx" ON "tournaments"("clube_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "tournaments_created_by_id_idx" ON "tournaments"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_prizes_tournament_id_position_key" ON "tournament_prizes"("tournament_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_entries_payout_transaction_id_key" ON "tournament_entries"("payout_transaction_id");

-- CreateIndex
CREATE INDEX "tournament_entries_user_id_status_idx" ON "tournament_entries"("user_id", "status");

-- CreateIndex
CREATE INDEX "tournament_entries_tournament_id_status_idx" ON "tournament_entries"("tournament_id", "status");

-- CreateIndex
CREATE INDEX "tournament_entries_clube_id_idx" ON "tournament_entries"("clube_id");

-- CreateIndex
CREATE INDEX "blind_structures_created_by_id_idx" ON "blind_structures"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "blind_levels_blind_structure_id_level_number_key" ON "blind_levels"("blind_structure_id", "level_number");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_blind_levels_tournament_id_level_number_key" ON "tournament_blind_levels"("tournament_id", "level_number");

-- CreateIndex
CREATE INDEX "tournament_tables_tournament_id_status_idx" ON "tournament_tables"("tournament_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_tables_tournament_id_table_number_key" ON "tournament_tables"("tournament_id", "table_number");

-- CreateIndex
CREATE INDEX "tournament_seats_tournament_table_id_active_idx" ON "tournament_seats"("tournament_table_id", "active");

-- CreateIndex
CREATE INDEX "tournament_seats_tournament_entry_id_created_at_idx" ON "tournament_seats"("tournament_entry_id", "created_at");

-- CreateIndex
CREATE INDEX "wallets_clube_id_idx" ON "wallets"("clube_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_clube_id_key" ON "wallets"("userId", "clube_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_idempotencyKey_key" ON "wallet_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_createdAt_idx" ON "wallet_transactions"("walletId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "wallet_transactions_pixChargeId_idx" ON "wallet_transactions"("pixChargeId");

-- CreateIndex
CREATE INDEX "wallet_transactions_pixWithdrawalId_idx" ON "wallet_transactions"("pixWithdrawalId");

-- CreateIndex
CREATE INDEX "wallet_transactions_tableSessionId_idx" ON "wallet_transactions"("tableSessionId");

-- CreateIndex
CREATE INDEX "wallet_transactions_tournamentEntryId_idx" ON "wallet_transactions"("tournamentEntryId");

-- CreateIndex
CREATE INDEX "wallet_transactions_createdById_idx" ON "wallet_transactions"("createdById");

-- CreateIndex
CREATE INDEX "wallet_transactions_type_status_idx" ON "wallet_transactions"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pix_charges_externalId_key" ON "pix_charges"("externalId");

-- CreateIndex
CREATE INDEX "pix_charges_userId_createdAt_idx" ON "pix_charges"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pix_charges_status_expiresAt_idx" ON "pix_charges"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "pix_withdrawals_externalId_key" ON "pix_withdrawals"("externalId");

-- CreateIndex
CREATE INDEX "pix_withdrawals_userId_createdAt_idx" ON "pix_withdrawals"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pix_withdrawals_status_idx" ON "pix_withdrawals"("status");

-- CreateIndex
CREATE INDEX "webhook_events_provider_eventType_createdAt_idx" ON "webhook_events"("provider", "eventType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_processedAt_idx" ON "webhook_events"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_externalEventId_key" ON "webhook_events"("provider", "externalEventId");

-- AddForeignKey
ALTER TABLE "clube_memberships" ADD CONSTRAINT "clube_memberships_clube_id_fkey" FOREIGN KEY ("clube_id") REFERENCES "clubes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clube_memberships" ADD CONSTRAINT "clube_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clube_payment_accounts" ADD CONSTRAINT "clube_payment_accounts_clube_id_fkey" FOREIGN KEY ("clube_id") REFERENCES "clubes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_clube_id_fkey" FOREIGN KEY ("clube_id") REFERENCES "clubes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_clube_id_fkey" FOREIGN KEY ("clube_id") REFERENCES "clubes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stack_movements" ADD CONSTRAINT "stack_movements_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "table_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stack_movements" ADD CONSTRAINT "stack_movements_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stack_movements" ADD CONSTRAINT "stack_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_clube_id_fkey" FOREIGN KEY ("clube_id") REFERENCES "clubes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_blind_structure_id_fkey" FOREIGN KEY ("blind_structure_id") REFERENCES "blind_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_prizes" ADD CONSTRAINT "tournament_prizes_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_clube_id_fkey" FOREIGN KEY ("clube_id") REFERENCES "clubes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_buy_in_transaction_id_fkey" FOREIGN KEY ("buy_in_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_payout_transaction_id_fkey" FOREIGN KEY ("payout_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blind_structures" ADD CONSTRAINT "blind_structures_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blind_levels" ADD CONSTRAINT "blind_levels_blind_structure_id_fkey" FOREIGN KEY ("blind_structure_id") REFERENCES "blind_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_blind_levels" ADD CONSTRAINT "tournament_blind_levels_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_tables" ADD CONSTRAINT "tournament_tables_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_tournament_table_id_fkey" FOREIGN KEY ("tournament_table_id") REFERENCES "tournament_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_tournament_entry_id_fkey" FOREIGN KEY ("tournament_entry_id") REFERENCES "tournament_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_from_table_id_fkey" FOREIGN KEY ("from_table_id") REFERENCES "tournament_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_moved_by_id_fkey" FOREIGN KEY ("moved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_clube_id_fkey" FOREIGN KEY ("clube_id") REFERENCES "clubes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_pixChargeId_fkey" FOREIGN KEY ("pixChargeId") REFERENCES "pix_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_pixWithdrawalId_fkey" FOREIGN KEY ("pixWithdrawalId") REFERENCES "pix_withdrawals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "table_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_tournamentEntryId_fkey" FOREIGN KEY ("tournamentEntryId") REFERENCES "tournament_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pix_charges" ADD CONSTRAINT "pix_charges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pix_withdrawals" ADD CONSTRAINT "pix_withdrawals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- SQL ESCRITO À MÃO — INVARIANTES QUE O PRISMA SCHEMA LANGUAGE NÃO EXPRESSA
-- ----------------------------------------------------------------------------
-- Tudo abaixo foi PRESERVADO INTEGRALMENTE do squash das três migrations
-- anteriores (`20260821013117_init_schema_integration`,
-- `20260822120000_tournament_tables_and_blinds` e
-- `20260822140000_tournament_table_capacity`). Nenhuma invariante foi perdida
-- na consolidação: o PSL não expressa `CHECK` nem `UNIQUE ... WHERE`, então
-- estas são a última barreira de integridade do domínio e precisam ser
-- reescritas à mão a cada squash.
-- ============================================================================

-- CheckConstraint
-- Última barreira anti double-spending (decisão D-03 de base.prisma): saldo
-- negativo é fisicamente impossível mesmo diante de um bug de aplicação que
-- escape do lock pessimista.
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_non_negative" CHECK ("balance" >= 0);

-- CheckConstraint
-- Faixa de buy-in não pode ser invertida (ver comentário de `Table` em
-- table.prisma) — sem isso nenhum valor seria aceitável ao sentar.
ALTER TABLE "tables" ADD CONSTRAINT "tables_buy_in_range_valid" CHECK ("min_buy_in" <= "max_buy_in");

-- CheckConstraint
-- Poker exige no mínimo 2 jogadores; full-ring comporta no máximo 10 — o
-- teto também limita `table_sessions.seat_number`.
ALTER TABLE "tables" ADD CONSTRAINT "tables_max_seats_valid" CHECK ("max_seats" BETWEEN 2 AND 10);

-- UniqueIndex (parcial)
-- Um assento só pode ter UMA sessão ACTIVE por vez. Parcial (não
-- `@@unique` do Prisma) para não impedir o jogador de voltar ao mesmo
-- assento depois de um CASHED_OUT anterior — ver comentário de
-- `TableSession` em table.prisma.
--
-- O escopo continua sendo `table_id` e NÃO `(clube_id, table_id)`: a mesa já
-- pertence a exatamente um clube, então `table_id` sozinho já é único no
-- universo inteiro. Prefixar com `clube_id` só AFROUXARIA a regra se algum dia
-- a coluna divergisse da do pai.
CREATE UNIQUE INDEX "table_sessions_active_seat_unique" ON "table_sessions"("table_id", "seat_number") WHERE "status" = 'ACTIVE';

-- UniqueIndex (parcial)
-- Um usuário só pode ter UMA sessão ACTIVE por mesa (mesmo raciocínio acima).
CREATE UNIQUE INDEX "table_sessions_active_user_unique" ON "table_sessions"("table_id", "user_id") WHERE "status" = 'ACTIVE';

-- UniqueIndex (parcial)
-- Um assento tem no máximo UMA ocupação ativa. Parcial (e não `@@unique` do
-- Prisma) porque `tournament_seats` é APPEND-ONLY: um índice total incluiria
-- as linhas históricas e impediria um jogador de voltar a um assento que já
-- ocupou depois de um rebalanceamento ou redraw.
CREATE UNIQUE INDEX "tournament_seats_active_seat_unique" ON "tournament_seats"("tournament_table_id", "seat_number") WHERE "active";

-- UniqueIndex (parcial)
-- Uma inscrição tem no máximo UM assento ativo — "ninguém em duas mesas ao
-- mesmo tempo". Mesmo raciocínio de parcialidade acima.
CREATE UNIQUE INDEX "tournament_seats_active_entry_unique" ON "tournament_seats"("tournament_entry_id") WHERE "active";

-- UniqueIndex (parcial)
-- Reentry (MT-DB-06): várias inscrições do mesmo jogador no mesmo torneio são
-- legítimas, DUAS VIVAS ao mesmo tempo não são. A corrida entre dois cliques
-- simultâneos morre aqui, no banco, e não na aplicação.
--
-- Escopo por `tournament_id` (não `clube_id`) pelo mesmo motivo dos índices de
-- `table_sessions`: o torneio já pertence a um único clube.
CREATE UNIQUE INDEX "tournament_entries_active_user_unique" ON "tournament_entries"("tournament_id", "user_id") WHERE "status" IN ('REGISTERED', 'PLAYING');

-- CheckConstraint
-- Mesmo intervalo de `tables.max_seats`: poker exige no mínimo 2 jogadores e
-- full-ring comporta no máximo 10. O teto também limita
-- `tournament_seats.seat_number`.
ALTER TABLE "tournament_tables" ADD CONSTRAINT "tournament_tables_capacity_valid" CHECK ("capacity" BETWEEN 2 AND 10);

-- CheckConstraint
-- Assento é 1-based. O teto depende de outra linha (`capacity` da mesa) e um
-- `CHECK` só enxerga a própria linha — fica com a aplicação.
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_seat_number_positive" CHECK ("seat_number" >= 1);

-- CheckConstraint
-- Nível de blind coerente: SB positivo, BB nunca menor que SB, ante não
-- negativo e duração positiva (duração 0 travaria o relógio no nível).
ALTER TABLE "blind_levels" ADD CONSTRAINT "blind_levels_blinds_valid" CHECK ("small_blind" > 0 AND "big_blind" >= "small_blind" AND "ante" >= 0 AND "duration_seconds" > 0);

-- CheckConstraint
-- Mesma regra na CÓPIA POR VALOR dentro do torneio: os níveis do torneio são
-- editáveis em pleno jogo (MT-BE-07) e precisam da mesma barreira.
ALTER TABLE "tournament_blind_levels" ADD CONSTRAINT "tournament_blind_levels_blinds_valid" CHECK ("small_blind" > 0 AND "big_blind" >= "small_blind" AND "ante" >= 0 AND "duration_seconds" > 0);

-- CheckConstraint
-- Coerência do relógio (MT-DB-03): RUNNING sem `level_ends_at` é um relógio
-- que não sabe quando o nível acaba; PAUSED sem `clock_remaining_ms` perde o
-- tempo restante e o nível "recomeça" ao retomar. NOT_STARTED e FINISHED não
-- têm exigência — nenhum nível está correndo.
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_clock_state_coherent" CHECK (
  ("clock_status" = 'RUNNING' AND "level_ends_at" IS NOT NULL AND "clock_remaining_ms" IS NULL)
  OR ("clock_status" = 'PAUSED' AND "clock_remaining_ms" IS NOT NULL)
  OR ("clock_status" IN ('NOT_STARTED', 'FINISHED'))
);

-- CheckConstraint
-- Mesmo intervalo de `tournament_tables.capacity`: o valor daqui é copiado
-- para toda mesa aberta, e um torneio com capacidade inválida só falharia lá
-- na frente, na primeira inscrição.
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_table_capacity_valid" CHECK ("table_capacity" BETWEEN 2 AND 10);
