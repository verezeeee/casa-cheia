-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'ADMIN');

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
CREATE TYPE "StackMovementReason" AS ENUM ('BUY_IN', 'CASH_OUT', 'HAND_RESULT', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
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
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
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
CREATE INDEX "tables_status_type_idx" ON "tables"("status", "type");

-- CreateIndex
CREATE INDEX "tables_created_by_id_idx" ON "tables"("created_by_id");

-- CreateIndex
CREATE INDEX "table_sessions_table_id_status_idx" ON "table_sessions"("table_id", "status");

-- CreateIndex
CREATE INDEX "table_sessions_user_id_status_idx" ON "table_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "stack_movements_table_session_id_created_at_idx" ON "stack_movements"("table_session_id", "created_at");

-- CreateIndex
CREATE INDEX "stack_movements_wallet_transaction_id_idx" ON "stack_movements"("wallet_transaction_id");

-- CreateIndex
CREATE INDEX "tournaments_status_starts_at_idx" ON "tournaments"("status", "starts_at");

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
CREATE UNIQUE INDEX "tournament_entries_tournament_id_user_id_key" ON "tournament_entries"("tournament_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

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
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_prizes" ADD CONSTRAINT "tournament_prizes_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_buy_in_transaction_id_fkey" FOREIGN KEY ("buy_in_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_payout_transaction_id_fkey" FOREIGN KEY ("payout_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
CREATE UNIQUE INDEX "table_sessions_active_seat_unique" ON "table_sessions"("table_id", "seat_number") WHERE "status" = 'ACTIVE';

-- UniqueIndex (parcial)
-- Um usuário só pode ter UMA sessão ACTIVE por mesa (mesmo raciocínio acima).
CREATE UNIQUE INDEX "table_sessions_active_user_unique" ON "table_sessions"("table_id", "user_id") WHERE "status" = 'ACTIVE';
