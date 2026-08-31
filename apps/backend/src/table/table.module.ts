import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClubModule } from '../club/club.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { TableController } from './table.controller';
import { TableService } from './table.service';

@Module({
  // ClubModule entra pelo `ClubeMembershipGuard` (rota `:clubeId`). CryptoModule
  // dá o `PasswordHasherService` que `TableService.sitGuestAtTable` usa pra
  // gerar a senha descartável do convidado (mesmo motivo de `ClubModule`).
  imports: [PrismaModule, AuthModule, ClubModule, WalletModule, CryptoModule],
  controllers: [TableController],
  providers: [TableService],
})
export class TableModule {}
