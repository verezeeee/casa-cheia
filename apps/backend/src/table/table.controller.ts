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
  ): Promise<TableSummaryDto> {
    return this.tableService.closeTable(clubeId, tableId);
  }
}
