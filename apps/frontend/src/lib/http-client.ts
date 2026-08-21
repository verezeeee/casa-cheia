import type { ApiErrorResponse } from '@poker-system/shared';
import { getApiUrl } from './env';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly path: string;
  readonly details: string | string[];

  constructor(payload: ApiErrorResponse) {
    super(Array.isArray(payload.message) ? payload.message.join(', ') : payload.message);
    this.name = 'ApiError';
    this.statusCode = payload.statusCode;
    this.path = payload.path;
    this.details = payload.message;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Timeout em ms para a requisição. Default: 15s. */
  timeoutMs?: number;
}

/**
 * Cliente HTTP centralizado do frontend.
 *
 * Toda chamada ao backend deve passar por aqui - nunca usar `fetch`
 * diretamente com URL hardcoded em um componente. A base URL vem de
 * `NEXT_PUBLIC_API_URL` (ver src/lib/env.ts), e erros HTTP são convertidos
 * em `ApiError`, alinhados ao formato padronizado do filtro global de
 * exceções do backend (`ApiErrorResponse`, de @poker-system/shared).
 */
async function request<TResponse>(path: string, options: RequestOptions = {}): Promise<TResponse> {
  const { body, timeoutMs = 15_000, headers, ...rest } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getApiUrl()}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const payload = (await safeJson(response)) as ApiErrorResponse | null;
      throw new ApiError(
        payload ?? {
          statusCode: response.status,
          message: response.statusText || 'Erro na requisição.',
          timestamp: new Date().toISOString(),
          path,
        },
      );
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    return (await response.json()) as TResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export const httpClient = {
  get: <TResponse>(path: string, options?: RequestOptions) =>
    request<TResponse>(path, { ...options, method: 'GET' }),
  post: <TResponse>(path: string, body?: unknown, options?: RequestOptions) =>
    request<TResponse>(path, { ...options, method: 'POST', body }),
  put: <TResponse>(path: string, body?: unknown, options?: RequestOptions) =>
    request<TResponse>(path, { ...options, method: 'PUT', body }),
  patch: <TResponse>(path: string, body?: unknown, options?: RequestOptions) =>
    request<TResponse>(path, { ...options, method: 'PATCH', body }),
  delete: <TResponse>(path: string, options?: RequestOptions) =>
    request<TResponse>(path, { ...options, method: 'DELETE' }),
};
