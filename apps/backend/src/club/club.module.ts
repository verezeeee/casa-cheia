import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClubController } from './club.controller';
import { ClubService } from './club.service';

@Module({
  // PrismaModule é @Global. AuthModule entra pelo JwtAuthGuard do controller.
  imports: [AuthModule],
  controllers: [ClubController],
  providers: [ClubService],
})
export class ClubModule {}
