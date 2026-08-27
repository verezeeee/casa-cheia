import { TournamentClockStatus } from '../enums/tournament-clock-status.enum';
import { BlindLevelDto } from './blind-level.dto';

/**
 * Estado do relógio de blinds, do ponto de vista de quem exibe (tela de staff
 * ou TV do clube).
 *
 * O SERVIDOR É A FONTE ÚNICA DO TEMPO. `serverTime` é obrigatório justamente
 * por isso: sem ele o cliente contaria os segundos com o relógio do próprio
 * dispositivo, e uma TV com clock desajustado mostraria tempo errado mesmo
 * recebendo `levelEndsAt` correto. O cliente calcula
 * `offset = Date.parse(serverTime) - Date.now()` uma vez e aplica esse offset
 * na contagem local; o polling corrige a deriva.
 */
export interface TournamentClockDto {
  clockStatus: TournamentClockStatus;

  /** Nível corrente; `null` enquanto `NOT_STARTED`. */
  currentLevel: BlindLevelDto | null;

  /** Próximo nível; `null` no último nível (ou antes do início). */
  nextLevel: BlindLevelDto | null;

  /**
   * Fim do nível corrente em ISO 8601 UTC. Preenchido apenas em `RUNNING` —
   * em `PAUSED` o que vale é `remainingMs`.
   */
  levelEndsAt: string | null;

  /** Restante do nível corrente, calculado pelo servidor. `0` quando esgotado. */
  remainingMs: number;

  /** Instante do servidor no momento da resposta, em ISO 8601 UTC. */
  serverTime: string;
}
