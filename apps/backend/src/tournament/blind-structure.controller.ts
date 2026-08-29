import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { BlindStructureDto } from '@poker-system/shared';
import { ClubeRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BlindStructureService } from './blind-structure.service';
import { CreateBlindStructureDto } from './dto/create-blind-structure.dto';

/**
 * Controller PRÓPRIO, e não rotas sob `tournaments/`: `@Get(':id')` do
 * `TournamentController` é catch-all e capturaria `GET /tournaments/blind-
 * structures` como "torneio de id `blind-structures`".
 *
 * Leitura é liberada a qualquer usuário autenticado (o jogador vê a estrutura
 * do torneio em que vai jogar); mutação é ADMIN.
 */
// TODO(CL-BE-05/06/07): rota ainda é `/blind-structures`, sem `:clubeId`. Ver
// a nota equivalente em `table/table.controller.ts`: handlers com `@Roles(...)`
// respondem 500 até a rota migrar para `/clubes/:clubeId/blind-structures`.
@Controller('blind-structures')
@UseGuards(JwtAuthGuard)
export class BlindStructureController {
  constructor(private readonly blindStructureService: BlindStructureService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBlindStructureDto,
  ): Promise<BlindStructureDto> {
    return this.blindStructureService.create(user.id, dto);
  }

  @Get()
  async list(): Promise<BlindStructureDto[]> {
    return this.blindStructureService.list();
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<BlindStructureDto> {
    return this.blindStructureService.get(id);
  }

  /** PUT, não PATCH: a grade de níveis é substituída por inteiro. */
  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() dto: CreateBlindStructureDto,
  ): Promise<BlindStructureDto> {
    return this.blindStructureService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(ClubeRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    return this.blindStructureService.delete(id);
  }
}
