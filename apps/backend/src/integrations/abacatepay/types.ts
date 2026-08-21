/**
 * Contratos tipados da integração com o gateway PIX AbacatePay.
 *
 * IMPORTANTE (dinheiro): todo valor monetário exposto por estes tipos é
 * `string` decimal ("125.50"), NUNCA `number`. O gateway trafega centavos
 * inteiros; a conversão acontece na borda (`amount.util.ts`) para que
 * nenhum valor do domínio passe por IEEE-754 em momento algum.
 *
 * TODO: ajustar payload/campos conforme doc oficial do AbacatePay quando a
 * integração for validada em sandbox real.
 */

/** Namespace de configuração `abacatePay` (ver `config/configuration.ts`). */
export interface AbacatePayConfig {
  apiKey?: string;
  baseUrl?: string;
  webhookSecret?: string;
  webhookToleranceSeconds?: number;
  /**
   * Campos opcionais: ainda não expostos pelo `registerAs('abacatePay')`.
   * Lidos de forma defensiva pelo client, que cai nos defaults
   * (`DEFAULT_TIMEOUT_MS` / `DEFAULT_RETRY_DELAY_MS`) quando ausentes.
   */
  timeoutMs?: number;
  retryDelayMs?: number;
}

/**
 * Status normalizado de uma cobrança PIX (entrada de dinheiro / depósito).
 * `UNKNOWN` é intencional: um status novo criado pelo provedor não deve
 * derrubar a chamada — ele é normalizado, logado e repassado ao chamador
 * junto com `rawStatus` para decisão/observabilidade.
 */
export type AbacatePayChargeStatus =
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'FAILED'
  | 'UNKNOWN';

/** Status normalizado de um saque PIX (saída de dinheiro / cashout). */
export type AbacatePayWithdrawalStatus =
  'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';

/** Resultado normalizado de criação/consulta de cobrança PIX. */
export interface AbacatePayChargeResult {
  /** Identificador da cobrança NO GATEWAY (chave de reconciliação externa). */
  externalId: string;
  /** Status normalizado; use `rawStatus` para auditoria do valor original. */
  status: AbacatePayChargeStatus;
  /** Status cru devolvido pelo provedor, preservado para logs/auditoria. */
  rawStatus: string;
  /** Valor da cobrança como string decimal ("125.50"). */
  amount: string;
  /** Referência idempotente enviada pelo chamador (id da transação local). */
  externalReferenceId?: string;
  /** Payload "copia e cola" do PIX (BR Code / EMV). */
  brCode?: string;
  /** QR Code em base64 (data URL), quando devolvido pelo provedor. */
  brCodeBase64?: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601, quando aplicável. */
  expiresAt?: string;
  /** ISO-8601, preenchido apenas quando a cobrança foi liquidada. */
  paidAt?: string;
}

/**
 * Resultado normalizado de uma solicitação de saque PIX.
 *
 * A chave PIX do beneficiário NÃO é devolvida nem logada (dado pessoal
 * sensível — LGPD); ela é conhecida apenas pela camada de wallet que a
 * originou.
 */
export interface AbacatePayWithdrawalResult {
  /** Identificador do saque NO GATEWAY. */
  externalId: string;
  status: AbacatePayWithdrawalStatus;
  rawStatus: string;
  /** Valor do saque como string decimal ("125.50"). */
  amount: string;
  externalReferenceId?: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601, preenchido apenas quando a transferência foi concluída. */
  completedAt?: string;
}

/** Entrada de `AbacatePayClient.createPixCharge`. */
export interface CreatePixChargeInput {
  /** String decimal com até 2 casas ("125.50"). Nunca `number`. */
  amount: string;
  /** Id da transação local — usado para reconciliação/idempotência. */
  externalReferenceId: string;
  description?: string;
}

/** Entrada de `AbacatePayClient.requestPixWithdrawal`. */
export interface RequestPixWithdrawalInput {
  /** String decimal com até 2 casas ("125.50"). Nunca `number`. */
  amount: string;
  /** Chave PIX do beneficiário (dado sensível: nunca logada). */
  pixKey: string;
  /** Tipo da chave: CPF | CNPJ | EMAIL | PHONE | RANDOM. */
  pixKeyType: string;
  /** Id da transação local — usado para reconciliação/idempotência. */
  externalReferenceId: string;
}
