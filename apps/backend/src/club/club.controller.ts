import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { ClubeMembershipDto, ClubeSummaryDto } from '@poker-system/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ClubService } from './club.service';
import { UpsertClubeMembershipDto } from './dto/upsert-clube-membership.dto';

/**
 * Não existe `POST /clubes`: criação de clube é curadoria manual via
 * seed/script administrativo (ADR-0003), nunca rota HTTP.
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
