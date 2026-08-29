import { ClubeRole } from '../enums/clube-role.enum';
import { ClubeStatus } from '../enums/clube-status.enum';

/**
 * Um clube do qual o usuário autenticado é membro — o item do seletor de clube.
 *
 * `role` é o papel DELE neste clube, não um atributo do clube: a mesma lista
 * pode trazer um clube onde ele é `ADMIN` e outro onde é `PLAYER` (ver ADR-0001).
 */
export interface ClubeSummaryDto {
  id: string;

  name: string;

  /**
   * Clube `SUSPENDED`/`CANCELLED` CONTINUA aparecendo na lista: o bloqueio é
   * operacional (não aceita movimento de dinheiro), não de visibilidade —
   * esconder o clube faria o jogador achar que perdeu o acesso ao histórico.
   * O cliente usa este campo para desabilitar a operação, não para filtrar.
   */
  status: ClubeStatus;

  /** Papel do usuário autenticado NESTE clube. */
  role: ClubeRole;
}
