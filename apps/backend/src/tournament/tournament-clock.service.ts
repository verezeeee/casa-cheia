import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TournamentClockDto } from '@poker-system/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateBlindLevelDto } from './dto/update-blind-level.dto';
import type { BlindLevelRow, TournamentClockView } from './tournament.mappers';
import { advanceClockToNow, toTournamentClockDto } from './tournament.mappers';

const MAX_ATTEMPTS = 3;

/** Nível como vem do banco: os campos de valor mais o `id` para o UPDATE. */
type StoredLevel = BlindLevelRow & { id: string };

/**
 * Resultado do planejamento de uma operação: o estado novo do relógio, a grade
 * como ela fica depois (só o PATCH a altera) e, quando houver, a escrita do
 * nível — que precisa cair na MESMA transação do lock otimista.
 */
type ClockPlan = {
  clock: TournamentClockView;
  levels: BlindLevelRow[];
  levelWrite?: {
    id: string;
    data: Pick<
      BlindLevelRow,
      'smallBlind' | 'bigBlind' | 'ante' | 'durationSeconds'
    >;
  };
  /**
   * RT-BE-01: esta operação é uma das duas portas de "o torneio começou de
   * verdade" e deve carimbar `Tournament.startedAt`. Só `start` a liga — nem
   * `pause`, nem `resume`, nem `next` marcam início.
   */
  stampStartedAt?: boolean;
};

/**
 * Relógio de blinds (MT-BE-07). A máquina de estados vive AQUI, não no banco
 * (mesma razão documentada para `Tournament.status` em tournament.prisma):
 *
 *   NOT_STARTED --start--> RUNNING <--pause/resume--> PAUSED
 *                          |    \__ next/previous __/    |
 *                          \------- next no último ------> FINISHED
 *
 * `next`/`previous` valem em RUNNING e em PAUSED (o diretor pode corrigir o
 * nível com o relógio parado); `FINISHED` é terminal. A invariante de colunas
 * (`RUNNING ⇒ levelEndsAt`, `PAUSED ⇒ clockRemainingMs`) é a mesma do CHECK
 * `tournaments_clock_state_coherent`.
 *
 * RUNNING também anda SOZINHO pelo tempo de parede: ninguém precisa clicar em
 * "Próximo nível" no instante exato em que o cronômetro zera. Toda leitura
 * (`read`) e toda mutação (`pause`/`resume`/`next`/`previous`/`updateLevel`)
 * passa o estado gravado por `advanceClockToNow` (`tournament.mappers.ts`)
 * antes de usá-lo — inclusive pulando vários níveis de uma vez se ninguém
 * olhou o relógio por um tempo, e virando `FINISHED` sozinho ao passar do
 * último nível. `next`/`previous` continuam existindo para o diretor corrigir
 * manualmente (ex.: pular um nível de propósito).
 */
@Injectable()
export class TournamentClockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Leitura pura do relógio (MT-BE-08) — uma query, nenhuma escrita.
   *
   * `new Date()` é lido DEPOIS da query, não antes: `serverTime` tem que ser o
   * instante da RESPOSTA (é dele que a TV tira o offset do próprio relógio), e
   * `remainingMs` é derivado do mesmo instante. Duas TVs consultando juntas
   * recebem o MESMO `levelEndsAt` — ele está gravado, só `remainingMs` e
   * `serverTime` variam entre as respostas.
   */
  /**
   * SEM `clubeId`: é a leitura consumida pela rota PÚBLICA de display (TV do
   * salão, `TournamentDisplayController`), que não tem sessão de usuário nem
   * `:clubeId` na rota — ver o TODO de risco no topo daquele controller sobre
   * o dia em que a conexão da aplicação migrar para o role sujeito a RLS.
   */
  async read(tournamentId: string): Promise<TournamentClockDto> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { blindLevels: { orderBy: { levelNumber: 'asc' } } },
    });
    if (!tournament) throw new NotFoundException('Torneio não encontrado.');

    const now = new Date();
    const clock = advanceClockToNow(tournament, tournament.blindLevels, now);
    return toTournamentClockDto(clock, tournament.blindLevels, now);
  }

  /**
   * `NOT_STARTED → RUNNING`, no primeiro nível da grade.
   *
   * Também CARIMBA a hora real de início do torneio (RT-BE-01) — ver
   * `stampStartedAt` em `mutate`. Este método continua sem tocar em
   * `Tournament.status`: quem faz `REGISTERING → RUNNING` é a primeira
   * eliminação (`TournamentService.eliminateEntry`).
   */
  async start(
    clubeId: string,
    tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.mutate(clubeId, tournamentId, (clock, levels, now) => {
      if (clock.clockStatus !== 'NOT_STARTED') {
        throw new BadRequestException(
          `Só é possível iniciar um relógio que ainda não começou (estado atual: ${clock.clockStatus}).`,
        );
      }
      const first = levels[0];
      if (!first) {
        throw new BadRequestException(
          'Torneio sem estrutura de blinds — cadastre os níveis antes de iniciar o relógio.',
        );
      }

      return {
        clock: {
          clockStatus: 'RUNNING',
          currentLevelNumber: first.levelNumber,
          levelEndsAt: endOfLevel(first, now),
          clockRemainingMs: null,
        },
        levels,
        stampStartedAt: true,
      };
    });
  }

  /** `RUNNING → PAUSED`, congelando o que sobrava do nível. */
  async pause(
    clubeId: string,
    tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.mutate(clubeId, tournamentId, (clock, levels, now) => {
      if (clock.clockStatus !== 'RUNNING') {
        throw new BadRequestException(
          `Só é possível pausar um relógio em andamento (estado atual: ${clock.clockStatus}).`,
        );
      }

      return {
        clock: {
          clockStatus: 'PAUSED',
          currentLevelNumber: clock.currentLevelNumber,
          levelEndsAt: null,
          // Clamp: pausar depois do nível estourado congela em 0, nunca negativo.
          clockRemainingMs: Math.max(
            0,
            (clock.levelEndsAt?.getTime() ?? 0) - now.getTime(),
          ),
        },
        levels,
      };
    });
  }

  /** `PAUSED → RUNNING`, devolvendo exatamente o tempo congelado. */
  async resume(
    clubeId: string,
    tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.mutate(clubeId, tournamentId, (clock, levels, now) => {
      if (clock.clockStatus !== 'PAUSED') {
        throw new BadRequestException(
          `Só é possível retomar um relógio pausado (estado atual: ${clock.clockStatus}).`,
        );
      }

      return {
        clock: {
          clockStatus: 'RUNNING',
          currentLevelNumber: clock.currentLevelNumber,
          levelEndsAt: new Date(now.getTime() + (clock.clockRemainingMs ?? 0)),
          clockRemainingMs: null,
        },
        levels,
      };
    });
  }

  /** Avança um nível; no último, encerra o relógio (`FINISHED`). */
  async next(
    clubeId: string,
    tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.mutate(clubeId, tournamentId, (clock, levels, now) =>
      step(clock, levels, now, 1),
    );
  }

  /** Volta um nível; recusa abaixo do primeiro. */
  async previous(
    clubeId: string,
    tournamentId: string,
  ): Promise<TournamentClockDto> {
    return this.mutate(clubeId, tournamentId, (clock, levels, now) =>
      step(clock, levels, now, -1),
    );
  }

  /**
   * Edita um nível DESTE torneio (a cópia, nunca o preset).
   *
   * REGRA CRÍTICA (PRD §5.3): mudar a duração do nível CORRENTE aplica o
   * DELTA sobre o que falta — `levelEndsAt += (nova - antiga)` em `RUNNING`,
   * `clockRemainingMs += delta` em `PAUSED`. Recalcular `now + novaDuração`
   * ressuscitaria o tempo já decorrido do nível.
   *
   * Fora de `RUNNING`/`PAUSED` (isto é, `NOT_STARTED` e `FINISHED`) e em
   * qualquer nível que não seja o corrente, a edição só troca os valores: não
   * há contagem em curso para ajustar, e mexer nas colunas de relógio de um
   * torneio encerrado o faria "voltar a andar".
   */
  async updateLevel(
    clubeId: string,
    tournamentId: string,
    levelNumber: number,
    dto: UpdateBlindLevelDto,
  ): Promise<TournamentClockDto> {
    return this.mutate(clubeId, tournamentId, (clock, levels) => {
      const level = levels.find((item) => item.levelNumber === levelNumber);
      if (!level) {
        throw new NotFoundException(
          `Nível ${levelNumber} não existe na grade de blinds deste torneio.`,
        );
      }

      const updated: StoredLevel = {
        ...level,
        smallBlind: dto.smallBlind ?? level.smallBlind,
        bigBlind: dto.bigBlind ?? level.bigBlind,
        ante: dto.ante ?? level.ante,
        durationSeconds: dto.durationSeconds ?? level.durationSeconds,
      };
      if (updated.bigBlind < updated.smallBlind) {
        throw new BadRequestException(
          `O big blind (${updated.bigBlind}) não pode ser menor que o small blind (${updated.smallBlind}).`,
        );
      }

      const deltaMs =
        (updated.durationSeconds - level.durationSeconds) * MS_PER_SECOND;
      const isCurrentLevel = clock.currentLevelNumber === levelNumber;
      let nextClock: TournamentClockView = clock;

      if (isCurrentLevel && deltaMs !== 0) {
        if (clock.clockStatus === 'RUNNING' && clock.levelEndsAt) {
          nextClock = {
            ...clock,
            levelEndsAt: new Date(clock.levelEndsAt.getTime() + deltaMs),
          };
        } else if (clock.clockStatus === 'PAUSED') {
          nextClock = {
            ...clock,
            clockRemainingMs: Math.max(
              0,
              (clock.clockRemainingMs ?? 0) + deltaMs,
            ),
          };
        }
      }

      return {
        clock: nextClock,
        levels: levels.map((item) =>
          item.levelNumber === levelNumber ? updated : item,
        ),
        levelWrite: {
          id: level.id,
          data: {
            smallBlind: updated.smallBlind,
            bigBlind: updated.bigBlind,
            ante: updated.ante,
            durationSeconds: updated.durationSeconds,
          },
        },
      };
    });
  }

  /**
   * Lê o estado, planeja e grava sob lock otimista de `Tournament.version` —
   * mesmo loop de retry de `TournamentService.registerEntry` /
   * `TableService`. O plano é refeito a cada tentativa, de propósito: um
   * `levelEndsAt` calculado sobre uma leitura obsoleta congelaria o tempo
   * errado.
   */
  private async mutate(
    clubeId: string,
    tournamentId: string,
    plan: (
      clock: TournamentClockView,
      levels: StoredLevel[],
      now: Date,
    ) => ClockPlan,
  ): Promise<TournamentClockDto> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const tournament = await this.prisma.tournament.findUnique({
        where: { id: tournamentId, clubeId },
        include: { blindLevels: { orderBy: { levelNumber: 'asc' } } },
      });
      if (!tournament) throw new NotFoundException('Torneio não encontrado.');

      const now = new Date();
      const advanced = advanceClockToNow(
        tournament,
        tournament.blindLevels,
        now,
      );
      const { clock, levels, levelWrite, stampStartedAt } = plan(
        advanced,
        tournament.blindLevels,
        now,
      );

      try {
        await this.prisma.withClube(clubeId, async (tx) => {
          if (levelWrite) {
            await tx.tournamentBlindLevel.update({
              where: { id: levelWrite.id },
              data: levelWrite.data,
            });
          }

          // Só as quatro colunas de relógio, nomeadas uma a uma: o planejador
          // recebe a LINHA INTEIRA do torneio como `clock`, e um plano que
          // devolva `{ ...clock, ... }` (é o caso de `updateLevel`) traria
          // `blindLevels`/`blindStructureId` junto — o Prisma recusa a coluna
          // desconhecida e o PATCH vira 500.
          const result = await tx.tournament.updateMany({
            where: { id: tournamentId, version: tournament.version },
            data: {
              clockStatus: clock.clockStatus,
              currentLevelNumber: clock.currentLevelNumber,
              levelEndsAt: clock.levelEndsAt,
              clockRemainingMs: clock.clockRemainingMs,
              version: { increment: 1 },
            },
          });
          if (result.count === 0) throw new OptimisticLockError();

          // RT-BE-01 — HORA REAL DE INÍCIO, em `updateMany` PRÓPRIO.
          //
          // Fora do update acima de propósito, por duas razões:
          //  1. Disciplina de colunas nomeadas (ver o comentário acima): aquele
          //     `data` descreve o ESTADO DO RELÓGIO e nada mais. `startedAt` é
          //     estado do TORNEIO e não sai do plano — sai daqui.
          //  2. `startedAt: null` no `where` faz do carimbo uma escrita
          //     ÚNICA, decidida pelo BANCO e não por um read-then-write: se a
          //     primeira eliminação (a outra porta de "começou", em
          //     `eliminateEntry`) já carimbou, esta linha afeta 0 registros e o
          //     horário mais antigo — o correto — permanece.
          // Sem `version` no `where`: o lock otimista já foi conquistado logo
          // acima, na mesma transação.
          if (stampStartedAt) {
            await tx.tournament.updateMany({
              where: { id: tournamentId, startedAt: null },
              data: { startedAt: now },
            });
          }
        });

        return toTournamentClockDto(clock, levels, now);
      } catch (error) {
        if (error instanceof OptimisticLockError) continue;
        throw error;
      }
    }

    throw new ConflictException(
      'Muita concorrência no relógio deste torneio — tente novamente.',
    );
  }
}

const MS_PER_SECOND = 1000;

function endOfLevel(level: BlindLevelRow, now: Date): Date {
  return new Date(now.getTime() + level.durationSeconds * MS_PER_SECOND);
}

/**
 * `next` (`+1`) e `previous` (`-1`): o novo nível começa inteiro, e o relógio
 * mantém o estado em que estava — quem estava pausado continua pausado, com a
 * duração cheia do nível novo em `clockRemainingMs`.
 */
function step(
  clock: TournamentClockView,
  levels: StoredLevel[],
  now: Date,
  direction: 1 | -1,
): ClockPlan {
  if (clock.clockStatus !== 'RUNNING' && clock.clockStatus !== 'PAUSED') {
    const verb = direction === 1 ? 'avançar' : 'voltar';
    throw new BadRequestException(
      `Só é possível ${verb} de nível com o relógio em andamento ou pausado (estado atual: ${clock.clockStatus}).`,
    );
  }

  const index = levels.findIndex(
    (level) => level.levelNumber === clock.currentLevelNumber,
  );
  if (index === -1) {
    throw new BadRequestException(
      'Nível corrente não existe na grade de blinds deste torneio.',
    );
  }

  const target = levels[index + direction];
  if (!target) {
    if (direction === -1) {
      throw new BadRequestException('O relógio já está no primeiro nível.');
    }
    // Último nível concluído: encerra mantendo o nível à vista da TV.
    return {
      clock: {
        clockStatus: 'FINISHED',
        currentLevelNumber: clock.currentLevelNumber,
        levelEndsAt: null,
        clockRemainingMs: null,
      },
      levels,
    };
  }

  const isRunning = clock.clockStatus === 'RUNNING';
  return {
    clock: {
      clockStatus: clock.clockStatus,
      currentLevelNumber: target.levelNumber,
      levelEndsAt: isRunning ? endOfLevel(target, now) : null,
      clockRemainingMs: isRunning
        ? null
        : target.durationSeconds * MS_PER_SECOND,
    },
    levels,
  };
}

/** Sinaliza conflito de `version` para o loop de retry — nunca escapa daqui. */
class OptimisticLockError extends Error {}
