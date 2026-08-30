import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClubModule } from '../club/club.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';

@Module({
  // ClubModule entra pelo `ClubeMembershipGuard` (rota `:clubeId`).
  imports: [PrismaModule, AuthModule, ClubModule],
  controllers: [EntriesController],
  providers: [EntriesService],
})
export class EntriesModule {}
