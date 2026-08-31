import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { ClubeMembershipDto, ClubeSummaryDto } from '@poker-system/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { SENSITIVE_ROUTE_THROTTLE } from '../common/http/rate-limits';
import { ClubService } from './club.service';
import { CreateClubeDto } from './dto/create-clube.dto';
import { JoinClubeDto } from './dto/join-clube.dto';
import { UpsertClubeMembershipDto } from './dto/upsert-clube-membership.dto';

/**
 * `POST /clubes` e `POST /clubes/entrar` rodam só com `JwtAuthGuard` (sem
 * `ClubeMembershipGuard`): por definição, o chamador ainda não é membro do
 * clube em nenhum dos dois — é exatamente isso que essas rotas resolvem.
 * Mesmo nível de guard de `GET /clubes`.
 */
@Controller('clubes')
@UseGuards(JwtAuthGuard)
export class ClubController {
  constructor(private readonly clubService: ClubService) {}

  @Get()
  async listMyClubes(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClubeSummaryDto[]> {
    return this.clubService.listMyClubes(user.id);
  }

  @Post()
  async createClube(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClubeDto,
  ): Promise<ClubeSummaryDto> {
    return this.clubService.createClube(user.id, dto);
  }

  /**
   * Throttled: é a rota que alguém poderia tentar forçar por brute-force do
   * código de 6 dígitos (~900 mil combinações). `createClube` acima não
   * corre esse risco — não tem segredo pra adivinhar.
   */
  @Post('entrar')
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  async joinByCode(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: JoinClubeDto,
  ): Promise<ClubeSummaryDto> {
    return this.clubService.joinByCode(user.id, dto);
  }

  @Get(':clubeId')
  async getClube(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
  ): Promise<ClubeSummaryDto> {
    return this.clubService.getClube(user.id, clubeId);
  }

  @Get(':clubeId/membros')
  async listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
  ): Promise<ClubeMembershipDto[]> {
    return this.clubService.listMembers(user.id, clubeId);
  }

  @Post(':clubeId/membros')
  async upsertMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
    @Body() dto: UpsertClubeMembershipDto,
  ): Promise<ClubeMembershipDto> {
    return this.clubService.upsertMember(user.id, clubeId, dto);
  }
}
