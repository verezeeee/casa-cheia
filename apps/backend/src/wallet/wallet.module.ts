import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AbacatePayWebhookController } from './abacatepay-webhook.controller';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

// `AbacatePayModule` removido — integração PIX em standby (ver docblock de
// `WalletService.createDeposit`). `WalletController`/`AbacatePayWebhookController`
// continuam registrados: só delegam para métodos que agora sempre recusam.
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WalletController, AbacatePayWebhookController],
  providers: [WalletService],
  // Exportado para o TableModule (buy-in/cash-out) e futuramente
  // TournamentModule reutilizarem `applyLedgerEntry` dentro da própria
  // transação — ver nota no método.
  exports: [WalletService],
})
export class WalletModule {}
