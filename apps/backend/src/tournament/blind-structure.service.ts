import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { BlindStructureDto } from '@poker-system/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toBlindStructureDto } from './blind-structure.mappers';
import type { BlindLevelInputDto } from './dto/blind-level-input.dto';
import type { CreateBlindStructureDto } from './dto/create-blind-structure.dto';

const INCLUDE_LEVELS = {
  levels: { orderBy: { levelNumber: 'asc' } },
} satisfies Prisma.BlindStructureInclude;

/**
 * CRUD do preset REUTILIZÁVEL de blinds (MT-BE-01).
 *
 * O preset é catálogo, não estado de jogo: nada aqui é lido em tempo de
 * torneio. Ao criar o torneio os níveis são COPIADOS para
 * `TournamentBlindLevel` (MT-BE-03), então editar/apagar um preset não altera
 * nenhum torneio já criado — e é por isso que este service não precisa de lock
 * otimista nem de idempotência: não há dinheiro nem concorrência de jogo.
 */
@Injectable()
export class BlindStructureService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    adminId: string,
    dto: CreateBlindStructureDto,
  ): Promise<BlindStructureDto> {
    assertValidLevelSet(dto.levels);

    const created = await this.prisma.blindStructure.create({
      data: {
        name: dto.name,
        createdById: adminId,
        levels: { create: dto.levels.map(toLevelData) },
      },
      include: INCLUDE_LEVELS,
    });

    return toBlindStructureDto(created);
  }

  /**
   * Catálogo inteiro, sem paginação: são presets do clube (dezenas, não
   * milhares) e a tela de criação de torneio precisa de todos no `<select>`.
   * ponytail: paginar quando um clube real passar de ~200 presets.
   */
  async list(): Promise<BlindStructureDto[]> {
    const structures = await this.prisma.blindStructure.findMany({
      include: INCLUDE_LEVELS,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return structures.map(toBlindStructureDto);
  }

  async get(id: string): Promise<BlindStructureDto> {
    const structure = await this.prisma.blindStructure.findUnique({
      where: { id },
      include: INCLUDE_LEVELS,
    });
    if (!structure) {
      throw new NotFoundException('Estrutura de blinds não encontrada.');
    }

    return toBlindStructureDto(structure);
  }

  /**
   * Substitui a grade INTEIRA numa única transação (apaga os níveis e recria).
   * Diff parcial nível a nível abriria a porta para uma grade meio-atualizada
   * caso a requisição falhasse no meio — e "sequencial de 1 a N" é uma regra
   * sobre o conjunto, que só faz sentido verificar contra o conjunto completo.
   *
   * Editar um preset em uso é PERMITIDO: os torneios já criados carregam sua
   * própria cópia dos níveis e não são afetados.
   */
  async update(
    id: string,
    dto: CreateBlindStructureDto,
  ): Promise<BlindStructureDto> {
    assertValidLevelSet(dto.levels);

    const updated = await this.prisma.$transaction(async (tx) => {
      const exists = await tx.blindStructure.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException('Estrutura de blinds não encontrada.');
      }

      await tx.blindLevel.deleteMany({ where: { blindStructureId: id } });

      return tx.blindStructure.update({
        where: { id },
        data: {
          name: dto.name,
          levels: { create: dto.levels.map(toLevelData) },
        },
        include: INCLUDE_LEVELS,
      });
    });

    return toBlindStructureDto(updated);
  }

  /**
   * O banco NÃO impede este delete: a FK de `Tournament.blindStructureId` é
   * `SetNull` (apagar preset não pode quebrar torneio histórico). Só que perder
   * silenciosamente a procedência de um torneio é uma surpresa ruim para o
   * diretor, então a aplicação recusa com 409 e manda ele desvincular antes.
   */
  async delete(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const structure = await tx.blindStructure.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!structure) {
        throw new NotFoundException('Estrutura de blinds não encontrada.');
      }

      const inUse = await tx.tournament.count({
        where: { blindStructureId: id },
      });
      if (inUse > 0) {
        throw new ConflictException(
          `Estrutura de blinds em uso por ${inUse} torneio(s) — não pode ser excluída.`,
        );
      }

      await tx.blindStructure.delete({ where: { id } });
    });
  }
}

function toLevelData(
  level: BlindLevelInputDto,
): Prisma.BlindLevelCreateWithoutBlindStructureInput {
  return {
    levelNumber: level.levelNumber,
    smallBlind: level.smallBlind,
    bigBlind: level.bigBlind,
    ante: level.ante ?? 0,
    durationSeconds: level.durationSeconds,
    isBreak: level.isBreak ?? false,
    breakLabel: level.breakLabel ?? null,
  };
}

/**
 * Validações que dependem do CONJUNTO de níveis (ou de dois campos do mesmo
 * nível) e por isso não cabem nos decorators do DTO nem num `CHECK`.
 */
function assertValidLevelSet(levels: BlindLevelInputDto[]): void {
  const seen = new Set<number>();

  for (const level of levels) {
    if (seen.has(level.levelNumber)) {
      throw new BadRequestException(
        `levelNumber ${level.levelNumber} aparece mais de uma vez.`,
      );
    }
    seen.add(level.levelNumber);

    if (level.bigBlind < level.smallBlind) {
      throw new BadRequestException(
        `Nível ${level.levelNumber}: bigBlind (${level.bigBlind}) não pode ser menor que smallBlind (${level.smallBlind}).`,
      );
    }

    if (level.isBreak && !level.breakLabel?.trim()) {
      throw new BadRequestException(
        `Nível ${level.levelNumber}: intervalo exige breakLabel (ex.: "Intervalo · 15 min").`,
      );
    }
  }

  for (let expected = 1; expected <= levels.length; expected += 1) {
    if (!seen.has(expected)) {
      throw new BadRequestException(
        `levelNumber deve ser sequencial de 1 a ${levels.length} — o nível ${expected} está faltando.`,
      );
    }
  }
}
