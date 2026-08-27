import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { BlindStructureService } from './blind-structure.service';
import type { CreateBlindStructureDto } from './dto/create-blind-structure.dto';

const LEVEL: CreateBlindStructureDto['levels'][number] = {
  levelNumber: 1,
  smallBlind: 25,
  bigBlind: 50,
  ante: 0,
  durationSeconds: 1200,
  isBreak: false,
};

const STRUCTURE_ROW = {
  id: 'bs-1',
  name: 'Turbo 20min',
  createdById: 'admin-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  levels: [
    { ...LEVEL, breakLabel: null, id: 'bl-1', blindStructureId: 'bs-1' },
  ],
};

function buildPrisma() {
  const tx = {
    blindStructure: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    blindLevel: { deleteMany: jest.fn() },
    tournament: { count: jest.fn() },
  };

  return {
    tx,
    blindStructure: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
}

function buildService() {
  const prisma = buildPrisma();
  const service = new BlindStructureService(prisma as unknown as PrismaService);
  return { service, prisma };
}

const dtoWith = (
  levels: CreateBlindStructureDto['levels'],
): CreateBlindStructureDto => ({ name: 'Turbo 20min', levels });

describe('BlindStructureService', () => {
  describe('validações de conjunto', () => {
    it('aceita níveis sequenciais de 1 a N (fora de ordem no payload)', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.create.mockResolvedValue(STRUCTURE_ROW);

      await service.create(
        'admin-1',
        dtoWith([
          { ...LEVEL, levelNumber: 2, smallBlind: 50, bigBlind: 100 },
          { ...LEVEL, levelNumber: 1 },
        ]),
      );

      expect(prisma.blindStructure.create).toHaveBeenCalled();
    });

    it('rejeita buraco na sequência de levelNumber', async () => {
      const { service, prisma } = buildService();

      await expect(
        service.create(
          'admin-1',
          dtoWith([
            { ...LEVEL, levelNumber: 1 },
            { ...LEVEL, levelNumber: 3 },
          ]),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.blindStructure.create).not.toHaveBeenCalled();
    });

    it('rejeita sequência que não começa em 1', async () => {
      const { service } = buildService();

      await expect(
        service.create('admin-1', dtoWith([{ ...LEVEL, levelNumber: 2 }])),
      ).rejects.toThrow(/sequencial de 1 a 1/);
    });

    it('rejeita levelNumber repetido', async () => {
      const { service } = buildService();

      await expect(
        service.create(
          'admin-1',
          dtoWith([
            { ...LEVEL, levelNumber: 1 },
            { ...LEVEL, levelNumber: 1 },
          ]),
        ),
      ).rejects.toThrow(/mais de uma vez/);
    });

    it('rejeita bigBlind menor que smallBlind', async () => {
      const { service } = buildService();

      await expect(
        service.create(
          'admin-1',
          dtoWith([{ ...LEVEL, smallBlind: 100, bigBlind: 50 }]),
        ),
      ).rejects.toThrow(/bigBlind \(50\) não pode ser menor/);
    });

    it('aceita bigBlind igual a smallBlind', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.create.mockResolvedValue(STRUCTURE_ROW);

      await service.create(
        'admin-1',
        dtoWith([{ ...LEVEL, smallBlind: 50, bigBlind: 50 }]),
      );

      expect(prisma.blindStructure.create).toHaveBeenCalled();
    });

    it('rejeita intervalo sem breakLabel (inclusive só com espaços)', async () => {
      const { service } = buildService();

      await expect(
        service.create(
          'admin-1',
          dtoWith([{ ...LEVEL, isBreak: true, breakLabel: undefined }]),
        ),
      ).rejects.toThrow(/exige breakLabel/);

      await expect(
        service.create(
          'admin-1',
          dtoWith([{ ...LEVEL, isBreak: true, breakLabel: '   ' }]),
        ),
      ).rejects.toThrow(/exige breakLabel/);
    });

    it('aceita intervalo com breakLabel', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.create.mockResolvedValue(STRUCTURE_ROW);

      await service.create(
        'admin-1',
        dtoWith([
          { ...LEVEL, isBreak: true, breakLabel: 'Intervalo · 15 min' },
        ]),
      );

      expect(prisma.blindStructure.create).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('aplica os defaults de ante/isBreak/breakLabel e grava o criador', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.create.mockResolvedValue(STRUCTURE_ROW);

      const result = await service.create(
        'admin-1',
        dtoWith([
          {
            levelNumber: 1,
            smallBlind: 25,
            bigBlind: 50,
            durationSeconds: 1200,
          },
        ]),
      );

      expect(prisma.blindStructure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Turbo 20min',
            createdById: 'admin-1',
            levels: {
              create: [
                {
                  levelNumber: 1,
                  smallBlind: 25,
                  bigBlind: 50,
                  ante: 0,
                  durationSeconds: 1200,
                  isBreak: false,
                  breakLabel: null,
                },
              ],
            },
          }),
        }),
      );
      expect(result).toEqual({
        id: 'bs-1',
        name: 'Turbo 20min',
        levels: [
          {
            levelNumber: 1,
            smallBlind: 25,
            bigBlind: 50,
            ante: 0,
            durationSeconds: 1200,
            isBreak: false,
            breakLabel: null,
          },
        ],
      });
    });
  });

  describe('get / list', () => {
    it('get devolve o preset mapeado', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.findUnique.mockResolvedValue(STRUCTURE_ROW);

      await expect(service.get('bs-1')).resolves.toMatchObject({ id: 'bs-1' });
    });

    it('get de preset inexistente é 404', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.findUnique.mockResolvedValue(null);

      await expect(service.get('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('list devolve o catálogo mapeado', async () => {
      const { service, prisma } = buildService();
      prisma.blindStructure.findMany.mockResolvedValue([STRUCTURE_ROW]);

      await expect(service.list()).resolves.toHaveLength(1);
    });
  });

  describe('update', () => {
    it('apaga os níveis antigos e recria, tudo na mesma transação', async () => {
      const { service, prisma } = buildService();
      prisma.tx.blindStructure.findUnique.mockResolvedValue({ id: 'bs-1' });
      prisma.tx.blindStructure.update.mockResolvedValue(STRUCTURE_ROW);

      await service.update('bs-1', dtoWith([{ ...LEVEL }]));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.tx.blindLevel.deleteMany).toHaveBeenCalledWith({
        where: { blindStructureId: 'bs-1' },
      });
      expect(prisma.tx.blindStructure.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'bs-1' } }),
      );
    });

    it('não abre transação quando a grade é inválida', async () => {
      const { service, prisma } = buildService();

      await expect(
        service.update('bs-1', dtoWith([{ ...LEVEL, levelNumber: 5 }])),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('preset inexistente é 404 e não apaga nível nenhum', async () => {
      const { service, prisma } = buildService();
      prisma.tx.blindStructure.findUnique.mockResolvedValue(null);

      await expect(
        service.update('nope', dtoWith([{ ...LEVEL }])),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.tx.blindLevel.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('apaga quando nenhum torneio referencia o preset', async () => {
      const { service, prisma } = buildService();
      prisma.tx.blindStructure.findUnique.mockResolvedValue({ id: 'bs-1' });
      prisma.tx.tournament.count.mockResolvedValue(0);

      await service.delete('bs-1');

      expect(prisma.tx.blindStructure.delete).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
      });
    });

    it('preset em uso por torneio é 409 e não é apagado', async () => {
      const { service, prisma } = buildService();
      prisma.tx.blindStructure.findUnique.mockResolvedValue({ id: 'bs-1' });
      prisma.tx.tournament.count.mockResolvedValue(2);

      await expect(service.delete('bs-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.tx.blindStructure.delete).not.toHaveBeenCalled();
    });

    it('preset inexistente é 404', async () => {
      const { service, prisma } = buildService();
      prisma.tx.blindStructure.findUnique.mockResolvedValue(null);

      await expect(service.delete('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.tx.tournament.count).not.toHaveBeenCalled();
    });
  });
});
