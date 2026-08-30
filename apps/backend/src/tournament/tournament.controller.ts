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
import { ClubeMembershipGuard } from '../club/guards/clube-membership.guard';
import { requireIdempotencyKey } from '../common/http/require-idempotency-key';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { EliminateEntryDto } from './dto/eliminate-entry.dto';
import { ListTournamentsQueryDto } from './dto/list-tournaments-query.dto';
import { RegisterEntryDto } from './dto/register-entry.dto';
import { UpdateBlindLevelDto } from './dto/update-blind-level.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { TournamentClockService } from './tournament-clock.service';
import { TournamentService } from './tournament.service';

/**
 * CL-BE-06: rota sob `/clubes/:clubeId/torneios`. `ClubeMembershipGuard` no
 * nível da CLASSE (e não repetido handler a handler): toda rota daqui exige
 * `:clubeId` resolvido, então a checagem de membership é comum a todas —
 * `RolesGuard` continua por handler, só onde há `@Roles(...)`, e roda DEPOIS
 * na cadeia (`JwtAuthGuard, ClubeMembershipGuard, RolesGuard`).
 */
@Controller('clubes/:clubeId/torneios')
@UseGuards(JwtAuthGuard, ClubeMembershipGuard)
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
    @Param('clubeId') clubeId: string,
    @Body() dto: CreateTournamentDto,
  ): Promise<TournamentSummaryDto> {
    return this.tournamentService.createTournament(user.id, clubeId, dto);
  }

  /** Só antes da 1ª inscrição — ver docblock de `TournamentService.updateTournament`. */
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async updateTournament(
    @Param('clubeId') clubeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTournamentDto,
  ): Promise<TournamentSummaryDto> {
    return this.tournamentService.updateTournament(clubeId, id, dto);
  }

  @Get()
  async listTournaments(
    @Param('clubeId') clubeId: string,
    @Query() query: ListTournamentsQueryDto,
  ): Promise<PaginatedResponse<TournamentSummaryDto>> {
    return this.tournamentService.listTournaments(
      clubeId,
      query.cursor,
      query.limit,
    );
  }

  @Get(':id')
  async getTournament(
    @Param('clubeId') clubeId: string,
    @Param('id') id: string,
  ): Promise<TournamentDetailResponse> {
    return this.tournamentService.getTournament(clubeId, id);
  }

  @Post(':id/register')
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RegisterEntryDto,
  ): Promise<TournamentEntryDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tournamentService.registerEntry(
      user.id,
      clubeId,
      tournamentId,
      idempotencyKey,
      dto.staffBonus ?? false,
    );
  }

  /** Cancela a PRÓPRIA inscrição — só antes do torneio começar (ver docblock do service). */
  @Post(':id/unregister')
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TournamentEntryDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tournamentService.unregisterEntry(
      user.id,
      clubeId,
      tournamentId,
      idempotencyKey,
    );
  }

  /**
   * ADMIN registrando outro membro do clube (já cadastrado) no torneio — ex.:
   * jogador chegou na mesa e quem lança a ficha é o staff. Mesma regra de
   * negócio e mesmo service de `register`, só muda de qual carteira sai o
   * buy-in (`userId` da rota, não `user.id` do token).
   */
  @Post(':id/register/:userId')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async registerForUser(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
    @Param('userId') userId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RegisterEntryDto,
  ): Promise<TournamentEntryDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tournamentService.registerEntry(
      userId,
      clubeId,
      tournamentId,
      idempotencyKey,
      dto.staffBonus ?? false,
    );
  }

  /**
   * ADMIN cancelando a inscrição de OUTRO membro — mesmo service de
   * `unregister` (mesma regra: só antes do torneio começar), só muda de
   * quem é o alvo (`userId` da rota, não `user.id` do token).
   */
  @Post(':id/unregister/:userId')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async unregisterForUser(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
    @Param('userId') userId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TournamentEntryDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tournamentService.unregisterEntry(
      userId,
      clubeId,
      tournamentId,
      idempotencyKey,
    );
  }

  @Post(':id/entries/:entryId/eliminate')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async eliminate(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
    @Param('entryId') entryId: string,
    @Body() dto: EliminateEntryDto,
  ): Promise<TournamentEntryDto> {
    return this.tournamentService.eliminateEntry(
      clubeId,
      tournamentId,
      entryId,
      dto,
    );
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
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
  ): Promise<TournamentTableMapDto> {
    return this.tournamentService.redrawTables(user.id, clubeId, tournamentId);
  }

  @Post(':id/finish')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async finish(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
  ): Promise<TournamentDetailResponse> {
    return this.tournamentService.finishTournament(clubeId, tournamentId);
  }

  // --- Relógio de blinds (MT-BE-07) — todas ADMIN, todas devolvem o estado
  // já atualizado para o staff não precisar de um GET logo em seguida.

  @Post(':id/clock/start')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async startClock(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.start(clubeId, tournamentId);
  }

  @Post(':id/clock/pause')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async pauseClock(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.pause(clubeId, tournamentId);
  }

  @Post(':id/clock/resume')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async resumeClock(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.resume(clubeId, tournamentId);
  }

  @Post(':id/clock/next')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async nextLevel(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.next(clubeId, tournamentId);
  }

  @Post(':id/clock/previous')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async previousLevel(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.clockService.previous(clubeId, tournamentId);
  }

  @Patch(':id/blind-levels/:levelNumber')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async updateBlindLevel(
    @Param('clubeId') clubeId: string,
    @Param('id') tournamentId: string,
    @Param('levelNumber', ParseIntPipe) levelNumber: number,
    @Body() dto: UpdateBlindLevelDto,
  ): Promise<TournamentClockDto> {
    return this.clockService.updateLevel(
      clubeId,
      tournamentId,
      levelNumber,
      dto,
    );
  }
}
