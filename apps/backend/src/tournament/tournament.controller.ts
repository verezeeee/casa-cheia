import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  PaginatedResponse,
  TournamentDetailResponse,
  TournamentEntryDto,
  TournamentSummaryDto,
} from '@poker-system/shared';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { EliminateEntryDto } from './dto/eliminate-entry.dto';
import { ListTournamentsQueryDto } from './dto/list-tournaments-query.dto';
import { TournamentService } from './tournament.service';

@Controller('tournaments')
@UseGuards(JwtAuthGuard)
export class TournamentController {
  constructor(private readonly tournamentService: TournamentService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async createTournament(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTournamentDto,
  ): Promise<TournamentSummaryDto> {
    return this.tournamentService.createTournament(user.id, dto);
  }

  @Get()
  async listTournaments(
    @Query() query: ListTournamentsQueryDto,
  ): Promise<PaginatedResponse<TournamentSummaryDto>> {
    return this.tournamentService.listTournaments(query.cursor, query.limit);
  }

  @Get(':id')
  async getTournament(
    @Param('id') id: string,
  ): Promise<TournamentDetailResponse> {
    return this.tournamentService.getTournament(id);
  }

  @Post(':id/register')
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') tournamentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TournamentEntryDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tournamentService.registerEntry(
      user.id,
      tournamentId,
      idempotencyKey,
    );
  }

  @Post(':id/entries/:entryId/eliminate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async eliminate(
    @Param('id') tournamentId: string,
    @Param('entryId') entryId: string,
    @Body() dto: EliminateEntryDto,
  ): Promise<TournamentEntryDto> {
    return this.tournamentService.eliminateEntry(tournamentId, entryId, dto);
  }

  @Post(':id/finish')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async finish(
    @Param('id') tournamentId: string,
  ): Promise<TournamentDetailResponse> {
    return this.tournamentService.finishTournament(tournamentId);
  }
}

/** Mesmo contrato de `WalletController`/`TableController` — ver nota lá sobre a Fase 5. */
function requireIdempotencyKey(
  value: string | undefined,
): asserts value is string {
  if (!value || value.trim().length === 0) {
    throw new BadRequestException('Header Idempotency-Key é obrigatório.');
  }
}
