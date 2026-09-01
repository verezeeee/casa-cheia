import { MoneyString } from '../types/money';
import { TableSummaryDto } from './table-summary.dto';

/**
 * Uma linha do relatório mostrado ao fechar a mesa — agregada POR JOGADOR
 * (`userId`), não por `TableSession`: um jogador pode ter mais de uma sessão
 * na mesma mesa (cash-out e rebuy voltando a sentar depois), e o relatório
 * soma todas antes de calcular o resultado, senão ele apareceria duplicado.
 */
export interface TableCloseReportItemDto {
  userId: string;

  userName: string;

  totalBuyIn: MoneyString;

  totalCashOut: MoneyString;

  /**
   * Deveria ser sempre '0.00' pós-fechamento; > 0 só indica uma sessão que
   * escapou do cash-out do fechamento (corrida rara com um sit concorrente
   * — ver docblock de `TableService.closeTable`).
   */
  currentStack: MoneyString;

  /**
   * `totalCashOut + currentStack - totalBuyIn`, já calculado no backend
   * (regra de ouro do projeto: dinheiro nunca faz aritmética no frontend).
   */
  netResult: MoneyString;
}

export interface TableCloseResultDto {
  table: TableSummaryDto;

  players: TableCloseReportItemDto[];
}
