import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { centsToDecimalString, decimalStringToCents } from './amount.util';
import {
  AbacatePayRequestError,
  AbacatePayUnavailableError,
  AbacatePayUnexpectedResponseError,
} from './errors';
import { redactSecrets, redactString } from './redact.util';
import type {
  AbacatePayChargeResult,
  AbacatePayChargeStatus,
  AbacatePayConfig,
  AbacatePayWithdrawalResult,
  AbacatePayWithdrawalStatus,
  CreatePixChargeInput,
  RequestPixWithdrawalInput,
} from './types';

/** Timeout padrão por tentativa (não pelo conjunto das tentativas). */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** Espera antes do retry único (backoff fixo, curto — a rota é síncrona). */
export const DEFAULT_RETRY_DELAY_MS = 200;
/**
 * 1 chamada + 1 retry. Deliberadamente NÃO é configurável: mais tentativas
 * em cima de um gateway financeiro aumentam a janela de duplicidade sem
 * ganho real de disponibilidade.
 */
export const MAX_ATTEMPTS = 2;

export const DEFAULT_BASE_URL = 'https://api.abacatepay.com/v2';

/**
 * Rotas do provedor (API v2), confirmadas contra o client oficial
 * (`github.com/AbacatePay/abacatepay-mcp`): cobrança PIX avulsa é um
 * "transparente" (`/transparents/*`), não um "checkout" (que exige produtos
 * pré-cadastrados) nem `/pixQrCode/*` (não existe). Saque para chave de
 * terceiros é `/pix/send`, não `/withdraw/create` (também não existe).
 */
export const ABACATEPAY_ENDPOINTS = {
  createPixCharge: '/transparents/create',
  getPixCharge: '/transparents/get',
  requestPixWithdrawal: '/pix/send',
} as const;

const CHARGE_STATUS_MAP: Readonly<Record<string, AbacatePayChargeStatus>> = {
  PENDING: 'PENDING',
  WAITING: 'PENDING',
  CREATED: 'PENDING',
  PAID: 'PAID',
  COMPLETED: 'PAID',
  APPROVED: 'PAID',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
};

const WITHDRAWAL_STATUS_MAP: Readonly<
  Record<string, AbacatePayWithdrawalStatus>
> = {
  PENDING: 'PENDING',
  CREATED: 'PENDING',
  WAITING: 'PENDING',
  PROCESSING: 'PROCESSING',
  IN_PROGRESS: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PAID: 'COMPLETED',
  APPROVED: 'COMPLETED',
  FAILED: 'FAILED',
  REJECTED: 'FAILED',
  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
};

/** Classificação interna do erro de transporte, antes do mapeamento de domínio. */
type FailureKind = 'client' | 'server' | 'network' | 'unknown';

interface ClassifiedFailure {
  kind: FailureKind;
  status?: number;
  code?: string;
  responseBody?: unknown;
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pickString = (
  source: Record<string, unknown>,
  keys: readonly string[],
): string | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const pickAmount = (
  source: Record<string, unknown>,
  keys: readonly string[],
): number | string | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      return value.trim();
    }
  }
  return undefined;
};

const sleep = (ms: number): Promise<void> =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve(undefined);

/**
 * Client HTTP isolado do gateway PIX AbacatePay.
 *
 * Responsabilidades: montar o payload do provedor, aplicar timeout + retry
 * controlado, normalizar a resposta em tipos do domínio e traduzir QUALQUER
 * falha em exceções de `errors.ts`. Nenhum `AxiosError` escapa daqui.
 *
 * NÃO é responsabilidade deste client (por design):
 * - idempotência de negócio (evitar depósito/saque duplicado). O retry
 *   automático só ocorre em falha de rede/5xx, onde o provedor pode ter
 *   processado a primeira tentativa; cabe à camada de wallet/ledger enviar
 *   um `externalReferenceId` estável por transação e desduplicar na
 *   confirmação (webhook/consulta) dentro de uma transação de banco.
 * - crédito/débito de saldo — este client não toca no ledger.
 */
@Injectable()
export class AbacatePayClient {
  private readonly logger = new Logger(AbacatePayClient.name);

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService,
  ) {
    const config = configService.get<AbacatePayConfig>('abacatePay') ?? {};

    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    if (this.apiKey.length === 0) {
      // Sem valor no log: apenas o fato de estar ausente.
      this.logger.warn(
        'ABACATEPAY_API_KEY ausente na configuração; chamadas ao gateway serão recusadas com 401.',
      );
    }
  }

  /**
   * Cria uma cobrança PIX (depósito).
   *
   * @param input.amount String decimal ("125.50"). Convertida em centavos
   * na borda; nunca use `number` no domínio.
   * @param input.externalReferenceId Id local ESTÁVEL da transação. O
   * chamador é responsável por reutilizar o mesmo valor em reprocessamentos
   * e por desduplicar no ledger: em `AbacatePayUnavailableError` a cobrança
   * pode ter sido criada mesmo sem resposta.
   *
   * @throws {AbacatePayRequestError} 4xx (sem retry).
   * @throws {AbacatePayUnavailableError} timeout/rede/5xx após 1 retry.
   * @throws {AbacatePayUnexpectedResponseError} 2xx com corpo fora do contrato.
   */
  async createPixCharge(
    input: CreatePixChargeInput,
  ): Promise<AbacatePayChargeResult> {
    const operation = 'createPixCharge';

    // Envelope `{method, data}` — é o mesmo endpoint para PIX/boleto
    // "transparente", diferenciado pelo `method`.
    const payload = {
      method: 'PIX',
      data: {
        amount: decimalStringToCents(input.amount, operation),
        description: input.description,
        externalId: input.externalReferenceId,
      },
    };

    const data = await this.send(operation, {
      method: 'POST',
      url: ABACATEPAY_ENDPOINTS.createPixCharge,
      data: payload,
    });

    return this.mapCharge(data, operation, input.externalReferenceId);
  }

  /**
   * Consulta o status atual de uma cobrança PIX pelo id DO GATEWAY.
   * Operação idempotente e segura de repetir — é o caminho de reconciliação
   * recomendado quando `createPixCharge` termina em
   * `AbacatePayUnavailableError`.
   *
   * @throws {AbacatePayRequestError} 4xx (inclui 404 de cobrança inexistente).
   * @throws {AbacatePayUnavailableError} timeout/rede/5xx após 1 retry.
   * @throws {AbacatePayUnexpectedResponseError} 2xx com corpo fora do contrato.
   */
  async getPixCharge(externalId: string): Promise<AbacatePayChargeResult> {
    const operation = 'getPixCharge';

    const data = await this.send(operation, {
      method: 'GET',
      url: ABACATEPAY_ENDPOINTS.getPixCharge,
      params: { id: externalId },
    });

    return this.mapCharge(data, operation);
  }

  /**
   * Solicita um saque PIX (cashout) para a chave informada.
   *
   * ATENÇÃO (chamador): esta operação NÃO é idempotente no provedor. O
   * débito do saldo deve ser efetivado no ledger ANTES da chamada, em
   * transação com lock pessimista sobre a carteira, e o
   * `externalReferenceId` deve ser único por solicitação. Em
   * `AbacatePayUnavailableError` o saque pode ter sido aceito: não estorne
   * automaticamente — deixe pendente e reconcilie por webhook/consulta.
   *
   * A `pixKey` é enviada ao gateway, mas nunca é logada nem devolvida no
   * resultado (dado pessoal — LGPD).
   *
   * @throws {AbacatePayRequestError} 4xx (sem retry).
   * @throws {AbacatePayUnavailableError} timeout/rede/5xx após 1 retry.
   * @throws {AbacatePayUnexpectedResponseError} 2xx com corpo fora do contrato.
   */
  async requestPixWithdrawal(
    input: RequestPixWithdrawalInput,
  ): Promise<AbacatePayWithdrawalResult> {
    const operation = 'requestPixWithdrawal';

    // A chave PIX de destino vai aninhada em `pix: {type, key}` — não como
    // campos soltos.
    const payload = {
      externalId: input.externalReferenceId,
      amount: decimalStringToCents(input.amount, operation),
      pix: {
        type: input.pixKeyType,
        key: input.pixKey,
      },
    };

    const data = await this.send(operation, {
      method: 'POST',
      url: ABACATEPAY_ENDPOINTS.requestPixWithdrawal,
      data: payload,
    });

    return this.mapWithdrawal(data, operation, input.externalReferenceId);
  }

  // ---------------------------------------------------------------------------
  // Transporte
  // ---------------------------------------------------------------------------

  /**
   * Executa a requisição com timeout, retry único e mapeamento de erro.
   *
   * O retry só cobre falhas em que repetir é seguro do ponto de vista do
   * transporte (rede/timeout/5xx). 4xx — inclusive 429 — nunca é retentado:
   * repetir um erro do cliente só reproduz o erro (e, no 429, agrava o rate
   * limit); a decisão de esperar cabe ao chamador.
   */
  private async send(
    operation: string,
    config: AxiosRequestConfig,
  ): Promise<unknown> {
    const requestConfig: AxiosRequestConfig = {
      ...config,
      baseURL: this.baseUrl,
      timeout: this.timeoutMs,
      headers: {
        ...(config.headers ?? {}),
        // Único ponto onde a API key é usada. Nunca é logada: nada abaixo
        // registra `requestConfig`, apenas método/url/status.
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    const route = `${String(config.method ?? 'GET').toUpperCase()} ${String(config.url ?? '')}`;
    let lastFailure: ClassifiedFailure | undefined;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      attemptsMade = attempt;

      try {
        const response = await firstValueFrom(
          this.httpService.request<unknown>(requestConfig),
        );

        this.logger.debug(
          `[${operation}] ${route} -> ${this.describeStatus(response)} (tentativa ${attempt}/${MAX_ATTEMPTS})`,
        );

        return response?.data;
      } catch (error) {
        const failure = this.classify(error);
        lastFailure = failure;

        if (failure.kind === 'client') {
          this.logger.warn(
            `[${operation}] ${route} -> ${failure.status} recusado pelo gateway (sem retry): ${this.safe(failure.message)}`,
          );

          throw new AbacatePayRequestError(
            `AbacatePay recusou a operação "${operation}" (HTTP ${failure.status}).`,
            operation,
            {
              status: failure.status as number,
              responseBody: this.safeValue(failure.responseBody),
            },
          );
        }

        const retryable =
          failure.kind === 'server' || failure.kind === 'network';

        if (retryable && attempt < MAX_ATTEMPTS) {
          this.logger.warn(
            `[${operation}] ${route} falhou (${failure.kind}${failure.status ? ` ${failure.status}` : ''}); repetindo 1 vez: ${this.safe(failure.message)}`,
          );
          await sleep(this.retryDelayMs);
          continue;
        }

        break;
      }
    }

    const failure = lastFailure as ClassifiedFailure;
    this.logger.error(
      `[${operation}] ${route} indisponível após ${attemptsMade} tentativa(s): ${this.safe(failure.message)}`,
    );

    throw new AbacatePayUnavailableError(
      `AbacatePay indisponível para a operação "${operation}" após ${attemptsMade} tentativa(s).`,
      operation,
      {
        status: failure.status,
        code: failure.code,
        attempts: attemptsMade,
      },
    );
  }

  /** Traduz o erro do axios em uma falha classificada e já sem `config`/headers. */
  private classify(error: unknown): ClassifiedFailure {
    if (isAxiosError(error)) {
      const status = error.response?.status;

      if (typeof status === 'number') {
        return {
          kind: status >= 500 ? 'server' : 'client',
          status,
          code: error.code,
          responseBody: error.response?.data,
          message: error.message,
        };
      }

      // Sem resposta: timeout (ECONNABORTED/ETIMEDOUT) ou erro de socket.
      return {
        kind: 'network',
        code: error.code,
        message: error.message,
      };
    }

    // Erro não-axios (bug interno, Observable vazio...): não é retentado —
    // repetir um defeito determinístico não ajuda.
    return {
      kind: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  private describeStatus(response: AxiosResponse<unknown> | undefined): string {
    return typeof response?.status === 'number'
      ? String(response.status)
      : '2xx';
  }

  /** Toda string que vai para log/mensagem de erro passa por aqui. */
  private safe(message: string): string {
    return redactString(message, [this.apiKey]);
  }

  /** Todo objeto anexado a uma exceção passa por aqui. */
  private safeValue(value: unknown): unknown {
    return redactSecrets(value, [this.apiKey]);
  }

  // ---------------------------------------------------------------------------
  // Normalização de resposta
  // ---------------------------------------------------------------------------

  /**
   * O AbacatePay (v2) envelopa toda resposta 2xx em `{ data }` — confirmado
   * contra o client oficial (`abacatepay-mcp`). O provedor sinaliza erro
   * via status HTTP não-2xx (tratado em `send`/`classify`), não com um
   * `error` dentro de um corpo 200; a checagem de `raw.error` abaixo é só
   * uma rede de segurança contra uma variação desse contrato. Também
   * aceitamos o objeto "cru" (sem envelope) por tolerância.
   */
  private unwrap(raw: unknown, operation: string): Record<string, unknown> {
    if (!isRecord(raw)) {
      throw new AbacatePayUnexpectedResponseError(
        `Resposta do AbacatePay em "${operation}" não é um objeto JSON.`,
        operation,
        this.safeValue(raw),
      );
    }

    const envelopeError = raw.error;
    if (envelopeError !== undefined && envelopeError !== null) {
      throw new AbacatePayUnexpectedResponseError(
        `AbacatePay respondeu 2xx com erro no corpo em "${operation}".`,
        operation,
        this.safeValue(envelopeError),
      );
    }

    return isRecord(raw.data) ? raw.data : raw;
  }

  private mapCharge(
    raw: unknown,
    operation: string,
    externalReferenceId?: string,
  ): AbacatePayChargeResult {
    const data = this.unwrap(raw, operation);

    const externalId = pickString(data, ['id', 'chargeId', 'pixQrCodeId']);
    const rawStatus = pickString(data, ['status']);
    const amountInCents = pickAmount(data, ['amount', 'value']);

    if (!externalId || !rawStatus || amountInCents === undefined) {
      throw new AbacatePayUnexpectedResponseError(
        `Resposta de "${operation}" sem os campos obrigatórios (id, status, amount).`,
        operation,
        this.safeValue(data),
      );
    }

    const status = CHARGE_STATUS_MAP[rawStatus.toUpperCase()];
    if (!status) {
      this.logger.warn(
        `[${operation}] status de cobrança desconhecido recebido do gateway: "${this.safe(rawStatus)}".`,
      );
    }

    return {
      externalId,
      status: status ?? 'UNKNOWN',
      rawStatus,
      amount: centsToDecimalString(amountInCents, operation),
      externalReferenceId:
        pickString(data, ['externalId', 'externalReferenceId']) ??
        externalReferenceId,
      brCode: pickString(data, ['brCode', 'br_code', 'pixCopyPaste']),
      brCodeBase64: pickString(data, ['brCodeBase64', 'qrCodeBase64']),
      createdAt: pickString(data, ['createdAt', 'created_at']) ?? this.now(),
      expiresAt: pickString(data, ['expiresAt', 'expires_at']),
      paidAt: pickString(data, ['paidAt', 'paid_at']),
    };
  }

  private mapWithdrawal(
    raw: unknown,
    operation: string,
    externalReferenceId?: string,
  ): AbacatePayWithdrawalResult {
    const data = this.unwrap(raw, operation);

    const externalId = pickString(data, ['id', 'withdrawalId', 'withdrawId']);
    const rawStatus = pickString(data, ['status']);
    const amountInCents = pickAmount(data, ['amount', 'value']);

    if (!externalId || !rawStatus || amountInCents === undefined) {
      throw new AbacatePayUnexpectedResponseError(
        `Resposta de "${operation}" sem os campos obrigatórios (id, status, amount).`,
        operation,
        this.safeValue(data),
      );
    }

    const status = WITHDRAWAL_STATUS_MAP[rawStatus.toUpperCase()];
    if (!status) {
      this.logger.warn(
        `[${operation}] status de saque desconhecido recebido do gateway: "${this.safe(rawStatus)}".`,
      );
    }

    return {
      externalId,
      status: status ?? 'UNKNOWN',
      rawStatus,
      amount: centsToDecimalString(amountInCents, operation),
      externalReferenceId:
        pickString(data, ['externalId', 'externalReferenceId']) ??
        externalReferenceId,
      createdAt: pickString(data, ['createdAt', 'created_at']) ?? this.now(),
      completedAt: pickString(data, [
        'completedAt',
        'completed_at',
        'paidAt',
        'paid_at',
      ]),
    };
  }

  private now(): string {
    return new Date().toISOString();
  }
}
