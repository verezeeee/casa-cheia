import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { BlindStructureController } from './blind-structure.controller';
import { BlindStructureService } from './blind-structure.service';
import { TournamentClockService } from './tournament-clock.service';
import { TournamentDisplayController } from './tournament-display.controller';
import { TournamentController } from './tournament.controller';
import { TournamentService } from './tournament.service';

/**
 * Presets de blinds vivem AQUI (e não em módulo próprio): mesmo bounded
 * context, mesma equipe de domínio — a estrutura de blinds só existe para ser
 * copiada para dentro de um torneio.
 *
 * CryptoModule dá o `PasswordHasherService` que
 * `TournamentService.registerGuestEntry` usa pra gerar a senha descartável do
 * convidado (mesmo motivo de `TableModule`).
 */
@Module({
  imports: [PrismaModule, AuthModule, WalletModule, CryptoModule],
  controllers: [
    TournamentController,
    TournamentDisplayController,
    BlindStructureController,
  ],
  providers: [TournamentService, BlindStructureService, TournamentClockService],
})
export class TournamentModule {}
