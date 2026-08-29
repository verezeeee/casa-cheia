import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClubModule } from '../club/club.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { TableController } from './table.controller';
import { TableService } from './table.service';

@Module({
  // ClubModule entra pelo `ClubeMembershipGuard` (rota `:clubeId`).
  imports: [PrismaModule, AuthModule, ClubModule, WalletModule],
  controllers: [TableController],
  providers: [TableService],
})
export class TableModule {}
