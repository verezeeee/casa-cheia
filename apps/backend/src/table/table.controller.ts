import {
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
  TableCloseResultDto,
  TableSeatDto,
  TableSummaryDto,
} from '@poker-system/shared';
import { ClubeRole } from '../generated/prisma';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ClubeMembershipGuard } from '../club/guards/clube-membership.guard';
import { requireIdempotencyKey } from '../common/http/require-idempotency-key';
import { CreateTableDto } from './dto/create-table.dto';
import { ListTablesQueryDto } from './dto/list-tables-query.dto';
import { RecordMovementDto } from './dto/record-movement.dto';
import { SitAtTableDto } from './dto/sit-at-table.dto';
import { SitGuestAtTableDto } from './dto/sit-guest-at-table.dto';
import { TableService } from './table.service';

@Controller('clubes/:clubeId/mesas')
@UseGuards(JwtAuthGuard)
export class TableController {
  constructor(private readonly tableService: TableService) {}

  @Post()
  @UseGuards(ClubeMembershipGuard, RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async createTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
    @Body() dto: CreateTableDto,
  ): Promise<TableSummaryDto> {
    return this.tableService.createTable(user.id, clubeId, dto);
  }

  @Get()
  @UseGuards(ClubeMembershipGuard)
  async listTables(
    @Param('clubeId') clubeId: string,
    @Query() query: ListTablesQueryDto,
  ): Promise<PaginatedResponse<TableSummaryDto>> {
    return this.tableService.listTables(clubeId, query.cursor, query.limit);
  }

  @Get(':id')
  @UseGuards(ClubeMembershipGuard)
  async getTable(
    @Param('clubeId') clubeId: string,
    @Param('id') tableId: string,
  ): Promise<TableSummaryDto> {
    return this.tableService.getTable(clubeId, tableId);
  }

  @Get(':id/seats')
  @UseGuards(ClubeMembershipGuard)
  async getSeats(
    @Param('clubeId') clubeId: string,
    @Param('id') tableId: string,
  ): Promise<TableSeatDto[]> {
    return this.tableService.getSeats(clubeId, tableId);
  }

  @Post(':id/sit')
  @UseGuards(ClubeMembershipGuard)
  async sitAtTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
    @Param('id') tableId: string,
    @Body() dto: SitAtTableDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TableSeatDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tableService.sitAtTable(
      user.id,
      clubeId,
      tableId,
      dto,
      idempotencyKey,
    );
  }

  @Post(':id/sessions/:sessionId/cash-out')
  @UseGuards(ClubeMembershipGuard)
  async cashOut(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
    @Param('id') tableId: string,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TableSeatDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tableService.cashOut(
      user.id,
      clubeId,
      tableId,
      sessionId,
      idempotencyKey,
    );
  }

  /**
   * ADMIN sentando outro membro do clube (já cadastrado e ACTIVE) — mesmo
   * `SitAtTableDto`, o buy-in sai da carteira DELE (`userId` da rota), não
   * da de quem chama.
   */
  @Post(':id/sit/:userId')
  @UseGuards(ClubeMembershipGuard, RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async sitAtTableForUser(
    @Param('clubeId') clubeId: string,
    @Param('id') tableId: string,
    @Param('userId') userId: string,
    @Body() dto: SitAtTableDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TableSeatDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tableService.sitAtTableForUser(
      clubeId,
      tableId,
      userId,
      dto,
      idempotencyKey,
    );
  }

  /** ADMIN sentando um jogador SEM CADASTRO — só nome e telefone (ver `TableService.sitGuestAtTable`). */
  @Post(':id/sit-guest')
  @UseGuards(ClubeMembershipGuard, RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async sitGuestAtTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
    @Param('id') tableId: string,
    @Body() dto: SitGuestAtTableDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TableSeatDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tableService.sitGuestAtTable(
      user.id,
      clubeId,
      tableId,
      dto,
      idempotencyKey,
    );
  }

  /** ADMIN fazendo cash-out da sessão de OUTRO jogador (ver `TableService.cashOutAsAdmin`). */
  @Post(':id/sessions/:sessionId/admin-cash-out')
  @UseGuards(ClubeMembershipGuard, RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async cashOutAsAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
    @Param('id') tableId: string,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TableSeatDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tableService.cashOutAsAdmin(
      user.id,
      clubeId,
      tableId,
      sessionId,
      idempotencyKey,
    );
  }

  @Post(':id/sessions/:sessionId/movements')
  @UseGuards(ClubeMembershipGuard, RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async recordMovement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clubeId') clubeId: string,
    @Param('id') tableId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: RecordMovementDto,
  ): Promise<TableSeatDto> {
    return this.tableService.recordMovement(
      user.id,
      clubeId,
      tableId,
      sessionId,
      dto,
    );
  }

  @Post(':id/close')
  @UseGuards(ClubeMembershipGuard, RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async closeTable(
    @Param('clubeId') clubeId: string,
    @Param('id') tableId: string,
  ): Promise<TableCloseResultDto> {
    return this.tableService.closeTable(clubeId, tableId);
  }
}
