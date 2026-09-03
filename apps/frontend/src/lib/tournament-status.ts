import { TournamentStatus } from '@poker-system/shared';
import type { BadgeVariant } from '@/components/ui';

/**
 * Cor do `Badge` de status do torneio.
 *
 * Extraído de `tournament-detail.tsx`/`tournament-list.tsx`, onde o mesmo
 * objeto estava duplicado literalmente: a tela de relatório (`RT-FE-03`) é o
 * terceiro consumidor, e três cópias de um mapeamento de cor é como um status
 * ganha uma cor diferente em cada tela sem ninguém perceber.
 *
 * `Record` completo de propósito: acrescentar um valor a `TournamentStatus` sem
 * escolher a cor dele passa a ser erro de compilação, não `undefined` em
 * runtime.
 */
export const TOURNAMENT_STATUS_VARIANT: Record<TournamentStatus, BadgeVariant> = {
  [TournamentStatus.DRAFT]: 'warning',
  [TournamentStatus.REGISTERING]: 'success',
  [TournamentStatus.RUNNING]: 'info',
  [TournamentStatus.FINISHED]: 'neutral',
  [TournamentStatus.CANCELLED]: 'danger',
};
