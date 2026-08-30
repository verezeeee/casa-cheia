import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { ClubController } from './club.controller';
import { ClubService } from './club.service';
import { ClubeMembershipGuard } from './guards/clube-membership.guard';

@Module({
  // PrismaModule é @Global. AuthModule entra pelo JwtAuthGuard do controller.
  // CryptoModule dá o PasswordHasherService que ClubService usa para
  // cadastrar um usuário novo direto pelo admin (senha gerada pelo servidor).
  imports: [AuthModule, CryptoModule],
  controllers: [ClubController],
  // `ClubeMembershipGuard` é exportado para outros módulos com rota
  // `:clubeId` (Table, Tournament, Wallet) poderem usá-lo em `@UseGuards`
  // sem duplicar o provider.
  providers: [ClubService, ClubeMembershipGuard],
  exports: [ClubeMembershipGuard],
})
export class ClubModule {}
