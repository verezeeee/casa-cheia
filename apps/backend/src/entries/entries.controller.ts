import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type {
  EntryHistoryItemDto,
  PaginatedResponse,
} from '@poker-system/shared';
import { ClubeRole } from '../generated/prisma';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CurrentClube } from '../club/decorators/current-clube.decorator';
import { ClubeMembershipGuard } from '../club/guards/clube-membership.guard';
import type { CurrentClubeContext } from '../club/types/current-clube.type';
import { ListEntriesQueryDto } from './dto/list-entries-query.dto';
import { EntriesService } from './entries.service';

/**
 * Histórico de participação (torneio + mesa). ADMIN vê o clube inteiro;
 * qualquer outro papel vê só as próprias entradas — a mesma rota decide o
 * escopo pelo papel de quem chama (`@CurrentClube()`), em vez de duas rotas
 * ou um `@Roles(ADMIN)` que bloquearia o PLAYER de ver as próprias.
 */
@Controller('clubes/:clubeId/entradas')
@UseGuards(JwtAuthGuard, ClubeMembershipGuard)
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Get()
  list(
    @Param('clubeId') clubeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentClube() clube: CurrentClubeContext,
    @Query() query: ListEntriesQueryDto,
  ): Promise<PaginatedResponse<EntryHistoryItemDto>> {
    const userId = clube.role === ClubeRole.ADMIN ? null : user.id;
    return this.entriesService.listEntries(
      clubeId,
      userId,
      query.cursor,
      query.limit,
    );
  }
}
