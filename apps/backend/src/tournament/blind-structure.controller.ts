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
import { ClubeMembershipGuard } from '../club/guards/clube-membership.guard';
import { BlindStructureService } from './blind-structure.service';
import { CreateBlindStructureDto } from './dto/create-blind-structure.dto';

/**
 * Controller PRÓPRIO, e não rotas sob `torneios/`: `@Get(':id')` do
 * `TournamentController` é catch-all e capturaria `GET /clubes/:clubeId/
 * torneios/blind-structures` como "torneio de id `blind-structures`".
 *
 * Leitura é liberada a qualquer usuário autenticado (o jogador vê a estrutura
 * do torneio em que vai jogar); mutação é ADMIN.
 *
 * CL-BE-06: rota sob `/clubes/:clubeId/blind-structures`, com
 * `ClubeMembershipGuard` para autorizar QUEM PODE mexer no catálogo do
 * clube — mas `BlindStructureService` continua SEM `clubeId` (decisão
 * CL-DB-01: `BlindStructure` é catálogo global, não tem coluna de tenant).
 * A autorização é só de rota; o dado por trás dela ainda não é particionado
 * por clube.
 */
@Controller('clubes/:clubeId/blind-structures')
@UseGuards(JwtAuthGuard, ClubeMembershipGuard)
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
