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
  /**
   * Pula o anexo do access token e a retentativa automática em 401. Usado
   * pelas próprias chamadas de auth (login/register/refresh/logout, ver
   * `lib/api/auth.ts`) — sem isso, um 401 de `POST /auth/refresh` disparia
   * o handler de "sessão expirada", que chama `refresh()` de novo: loop.
   */
  skipAuthRetry?: boolean;
}

/**
 * Access token da sessão atual, mantido SOMENTE em memória (nunca
 * `localStorage`/`sessionStorage` — ver `lib/api/auth.ts`). Escrito pelo
 * provider de sessão a cada login/refresh/logout.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Chamado uma única vez por requisição quando o backend responde 401.
 * Deve tentar renovar a sessão (`authApi.refresh()`) e devolver o novo
 * access token, ou `null` se a renovação falhar (sessão realmente expirada).
 * Registrado pelo provider de sessão — sem ele, um 401 apenas propaga.
 */
let unauthorizedHandler: (() => Promise<string | null>) | null = null;

export function setUnauthorizedHandler(handler: (() => Promise<string | null>) | null): void {
  unauthorizedHandler = handler;
}

/**
 * Promise do refresh em andamento, se houver. Sem isso, cada request em voo
 * que toma 401 no mesmo instante (comum: várias queries com polling na
 * mesma tela) chamaria `unauthorizedHandler()` — e portanto `/auth/refresh`
 * — em paralelo, todas com o MESMO refresh token ainda não rotacionado. O
 * backend rotaciona o token a cada chamada e trata reapresentação do token
 * antigo como reuso/roubo, derrubando a sessão inteira. Compartilhar uma
 * única promise faz todo 401 concorrente esperar o mesmo refresh em vez de
 * disparar o seu.
 */
let refreshInFlight: Promise<string | null> | null = null;

function getOrCreateRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = unauthorizedHandler!().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
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
async function request<TResponse>(
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<TResponse> {
  const { body, timeoutMs = 15_000, headers, skipAuthRetry, ...rest } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getApiUrl()}${path}`, {
      ...rest,
      // O backend manda o refresh token num cookie httpOnly (`auth.controller.ts`)
      // e já habilita `credentials: true` no CORS especificamente por causa
      // disso — sem `include` aqui, o browser nunca leva o cookie numa
      // requisição cross-origin (front em :3000, backend em :3001), então
      // `POST /auth/refresh` fica sempre sem cookie e a sessão nunca sobrevive
      // a um reload.
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 401 && !isRetry && !skipAuthRetry && unauthorizedHandler) {
        const renewedToken = await getOrCreateRefresh();
        if (renewedToken) {
          return request<TResponse>(path, options, true);
        }
      }

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
