import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClubController } from './club.controller';
import { ClubService } from './club.service';
import { ClubeMembershipGuard } from './guards/clube-membership.guard';

@Module({
  // PrismaModule é @Global. AuthModule entra pelo JwtAuthGuard do controller.
  imports: [AuthModule],
  controllers: [ClubController],
  // `ClubeMembershipGuard` é exportado para outros módulos com rota
  // `:clubeId` (Table, Tournament, Wallet) poderem usá-lo em `@UseGuards`
  // sem duplicar o provider.
  providers: [ClubService, ClubeMembershipGuard],
  exports: [ClubeMembershipGuard],
})
export class ClubModule {}
