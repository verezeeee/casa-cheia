import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { TournamentController } from './tournament.controller';
import { TournamentService } from './tournament.service';

@Module({
  imports: [PrismaModule, AuthModule, WalletModule],
  controllers: [TournamentController],
  providers: [TournamentService],
})
export class TournamentModule {}
