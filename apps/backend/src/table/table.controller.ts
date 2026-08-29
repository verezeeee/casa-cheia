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
  TableSeatDto,
  TableSummaryDto,
} from '@poker-system/shared';
import { ClubeRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { requireIdempotencyKey } from '../common/http/require-idempotency-key';
import { CreateTableDto } from './dto/create-table.dto';
import { ListTablesQueryDto } from './dto/list-tables-query.dto';
import { RecordMovementDto } from './dto/record-movement.dto';
import { SitAtTableDto } from './dto/sit-at-table.dto';
import { TableService } from './table.service';

// TODO(CL-BE-05/06/07): rota ainda é `/tables`, sem `:clubeId`. Enquanto ela
// não migrar para `/clubes/:clubeId/tables` (com `ClubeMembershipGuard` na
// cadeia), os handlers com `@Roles(...)` respondem 500 — de propósito:
// `RolesGuard` recusa autorizar sem saber o clube. Fail-closed é preferível a
// remover o `@Roles`, o que liberaria criação de mesa para qualquer jogador.
@Controller('tables')
@UseGuards(JwtAuthGuard)
export class TableController {
  constructor(private readonly tableService: TableService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async createTable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTableDto,
  ): Promise<TableSummaryDto> {
    return this.tableService.createTable(user.id, dto);
  }

  @Get()
  async listTables(
    @Query() query: ListTablesQueryDto,
  ): Promise<PaginatedResponse<TableSummaryDto>> {
    return this.tableService.listTables(query.cursor, query.limit);
  }

  @Get(':id/seats')
  async getSeats(@Param('id') tableId: string): Promise<TableSeatDto[]> {
    return this.tableService.getSeats(tableId);
  }

  @Post(':id/sit')
  async sitAtTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') tableId: string,
    @Body() dto: SitAtTableDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TableSeatDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tableService.sitAtTable(user.id, tableId, dto, idempotencyKey);
  }

  @Post(':id/sessions/:sessionId/cash-out')
  async cashOut(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') tableId: string,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TableSeatDto> {
    requireIdempotencyKey(idempotencyKey);
    return this.tableService.cashOut(
      user.id,
      tableId,
      sessionId,
      idempotencyKey,
    );
  }

  @Post(':id/sessions/:sessionId/movements')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async recordMovement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') tableId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: RecordMovementDto,
  ): Promise<TableSeatDto> {
    return this.tableService.recordMovement(user.id, tableId, sessionId, dto);
  }

  @Post(':id/close')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async closeTable(@Param('id') tableId: string): Promise<TableSummaryDto> {
    return this.tableService.closeTable(tableId);
  }
}
