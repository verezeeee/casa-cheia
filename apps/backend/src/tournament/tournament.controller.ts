import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  PaginatedResponse,
  TournamentClockDto,
  TournamentDetailResponse,
  TournamentEntryDto,
  TournamentSummaryDto,
  TournamentTableMapDto,
} from '@poker-system/shared';
import { ClubeRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { requireIdempotencyKey } from '../common/http/require-idempotency-key';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { EliminateEntryDto } from './dto/eliminate-entry.dto';
import { ListTournamentsQueryDto } from './dto/list-tournaments-query.dto';
import { UpdateBlindLevelDto } from './dto/update-blind-level.dto';
import { TournamentClockService } from './tournament-clock.service';
import { TournamentService } from './tournament.service';

// TODO(CL-BE-05/06/07): rota ainda é `/tournaments`, sem `:clubeId`. Ver a
// nota equivalente em `table/table.controller.ts`: handlers com `@Roles(...)`
// respondem 500 até a rota migrar para `/clubes/:clubeId/tournaments`.
@Controller('tournaments')
@UseGuards(JwtAuthGuard)
export class TournamentController {
  constructor(
    private readonly tournamentService: TournamentService,
    private readonly clockService: TournamentClockService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
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
  @Roles(ClubeRole.ADMIN)
  async eliminate(
    @Param('id') tournamentId: string,
    @Param('entryId') entryId: string,
    @Body() dto: EliminateEntryDto,
  ): Promise<TournamentEntryDto> {
    return this.tournamentService.eliminateEntry(tournamentId, entryId, dto);
  }

  /**
   * Redraw manual (MT-BE-06). Permitido com o relógio em andamento — quem
   * decide é o diretor; a resposta é o mapa novo para o staff conferir.
   */
  @Post(':id/redraw')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async redraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') tournamentId: string,
  ): Promise<TournamentTableMapDto> {
    return this.tournamentService.redrawTables(user.id, tournamentId);
  }

  @Post(':id/finish')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async finish(
    @Param('id') tournamentId: string,
  ): Promise<TournamentDetailResponse> {
    return this.tournamentService.finishTournament(tournamentId);
  }

  // --- Relógio de blinds (MT-BE-07) — todas ADMIN, todas devolvem o estado
  // já atualizado para o staff não precisar de um GET logo em seguida.

  @Post(':id/clock/start')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async startClock(
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.start(tournamentId);
  }

  @Post(':id/clock/pause')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async pauseClock(
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.pause(tournamentId);
  }

  @Post(':id/clock/resume')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async resumeClock(
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.resume(tournamentId);
  }

  @Post(':id/clock/next')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async nextLevel(
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.next(tournamentId);
  }

  @Post(':id/clock/previous')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async previousLevel(
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.previous(tournamentId);
  }

  @Patch(':id/blind-levels/:levelNumber')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async updateBlindLevel(
    @Param('id') tournamentId: string,
    @Param('levelNumber', ParseIntPipe) levelNumber: number,
    @Body() dto: UpdateBlindLevelDto,
  ): Promise<TournamentClockDto> {
    return this.clockService.updateLevel(tournamentId, levelNumber, dto);
  }
}
