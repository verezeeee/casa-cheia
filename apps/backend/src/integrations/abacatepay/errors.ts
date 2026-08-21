/**
 * Exceções de domínio da integração AbacatePay.
 *
 * Regra de isolamento: NENHUM `AxiosError` cru atravessa a fronteira do
 * client. O chamador (wallet/ledger) só enxerga estas classes, cujo
 * conteúdo já passou pelo `redactSecrets` — logo, nem a API key, nem o
 * header Authorization, nem a chave PIX do beneficiário podem ser
 * serializados a partir delas.
 */

/** Raiz da hierarquia — permite `catch (e) { if (e instanceof AbacatePayError) }`. */
export abstract class AbacatePayError extends Error {
  /** Operação lógica que falhou (ex: `createPixCharge`). */
  readonly operation: string;

  protected constructor(message: string, operation: string) {
    super(message);
    this.name = new.target.name;
    this.operation = operation;
  }
}

/**
 * Gateway indisponível: timeout, erro de rede ou HTTP 5xx que persistiu
 * depois do retry único.
 *
 * Semântica para o chamador: o resultado da operação é INDETERMINADO — a
 * requisição pode ter sido processada pelo provedor mesmo sem resposta.
 * Não trate como "falhou": marque a transação local como pendente e
 * reconcilie por consulta (`getPixCharge`) ou webhook.
 */
export class AbacatePayUnavailableError extends AbacatePayError {
  /** Status HTTP quando houve resposta 5xx; `undefined` em erro de rede. */
  readonly status?: number;
  /** Código de rede do axios (ECONNABORTED, ETIMEDOUT, ...), já sanitizado. */
  readonly code?: string;
  /** Número de tentativas efetuadas (1 chamada + retries). */
  readonly attempts: number;

  constructor(
    message: string,
    operation: string,
    details: { status?: number; code?: string; attempts: number },
  ) {
    super(message, operation);
    this.status = details.status;
    this.code = details.code;
    this.attempts = details.attempts;
  }
}

/**
 * Erro atribuível à requisição (HTTP 4xx): payload inválido, autenticação
 * recusada, saldo insuficiente na conta do gateway, rate limit etc.
 *
 * NUNCA é retentado automaticamente — repetir um 4xx só produz o mesmo
 * erro (e, em 429, agrava o rate limit).
 */
export class AbacatePayRequestError extends AbacatePayError {
  readonly status: number;
  /** Corpo do erro devolvido pelo gateway, já redigido, para debug. */
  readonly responseBody: unknown;

  constructor(
    message: string,
    operation: string,
    details: { status: number; responseBody: unknown },
  ) {
    super(message, operation);
    this.status = details.status;
    this.responseBody = details.responseBody;
  }
}

/**
 * O gateway respondeu 2xx, mas com um corpo que não satisfaz o contrato
 * mínimo esperado (campos obrigatórios ausentes/ininteligíveis).
 * Tratado como falha dura: seguir adiante com dados parciais corromperia
 * o ledger.
 */
export class AbacatePayUnexpectedResponseError extends AbacatePayError {
  /** Trecho redigido do corpo recebido, para diagnóstico. */
  readonly responseBody: unknown;

  constructor(message: string, operation: string, responseBody: unknown) {
    super(message, operation);
    this.responseBody = responseBody;
  }
}

/**
 * Valor monetário fora do contrato da integração (não é string decimal
 * positiva com até 2 casas). É um erro de programação do chamador e por
 * isso falha antes de qualquer I/O — nada é enviado ao gateway.
 */
export class AbacatePayInvalidAmountError extends AbacatePayError {
  constructor(message: string, operation = 'amount') {
    super(message, operation);
  }
}
