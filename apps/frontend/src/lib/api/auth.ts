import type { AuthTokensResponse, SessionUser } from '@poker-system/shared';
import { httpClient, type RequestOptions } from '../http-client';
import type { LoginRequest, RegisterRequest } from './types';

/**
 * Camada de acesso ao módulo de autenticação do backend.
 *
 * Regras que este arquivo precisa respeitar:
 *
 * 1. Nenhuma URL é montada aqui. Todo path é relativo e a base vem do
 *    `httpClient` (que lê `NEXT_PUBLIC_API_URL` via `lib/env.ts`).
 * 2. Toda chamada usa `credentials: 'include'`. O refresh token é entregue
 *    pelo backend em cookie `httpOnly` + `Secure` + `SameSite`; sem esse flag
 *    o browser não envia o cookie em requisições cross-origin (frontend e API
 *    rodam em origens distintas) e `refresh`/`logout` falhariam com 401.
 * 3. Nenhum token é persistido em `localStorage`/`sessionStorage`. O access
 *    token é devolvido ao chamador e deve ficar SOMENTE em memória (a sessão
 *    é reidratada via `refresh()`), o que remove a superfície de roubo de
 *    token por XSS. A guarda desse estado é responsabilidade do provider de
 *    sessão (T-FE-02), não desta camada.
 */

/** Paths relativos à base URL da API - compostos pelo `httpClient`. */
const AUTH_PATHS = {
  register: '/auth/register',
  login: '/auth/login',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  me: '/auth/me',
} as const;

/**
 * Opções aplicadas a toda chamada de auth. Ver regra (2) acima.
 *
 * `skipAuthRetry`: estas quatro chamadas NUNCA devem disparar a retentativa
 * automática de 401 do `httpClient` (ver `lib/http-client.ts`) — um 401 aqui
 * é o resultado em si (credenciais inválidas, refresh expirado), não um
 * access token vencido a renovar. Sem isso, um 401 de `refresh()` chamaria
 * o handler de sessão expirada, que chama `refresh()` de novo: loop.
 * `me()`, de propósito, NÃO usa esta constante — é a chamada que deve se
 * beneficiar da renovação automática.
 */
const WITH_CREDENTIALS: RequestOptions = Object.freeze({
  credentials: 'include',
  skipAuthRetry: true,
});

/** Cria a conta e devolve a projeção pública do usuário criado. */
export function register(input: RegisterRequest): Promise<SessionUser> {
  return httpClient.post<SessionUser>(AUTH_PATHS.register, input, WITH_CREDENTIALS);
}

/**
 * Autentica o usuário. Devolve apenas o access token (curta duração);
 * o refresh token vem no cookie httpOnly da resposta e é inacessível ao JS.
 */
export function login(input: LoginRequest): Promise<AuthTokensResponse> {
  return httpClient.post<AuthTokensResponse>(AUTH_PATHS.login, input, WITH_CREDENTIALS);
}

/**
 * Renova o access token. Não envia corpo: a credencial é o cookie httpOnly,
 * anexado automaticamente pelo browser graças a `credentials: 'include'`.
 */
export function refresh(): Promise<AuthTokensResponse> {
  return httpClient.post<AuthTokensResponse>(AUTH_PATHS.refresh, undefined, WITH_CREDENTIALS);
}

/** Encerra a sessão no servidor (revoga o refresh token e limpa o cookie). */
export function logout(): Promise<void> {
  return httpClient.post<void>(AUTH_PATHS.logout, undefined, WITH_CREDENTIALS);
}

/**
 * Usuário autenticado no momento, segundo o backend.
 *
 * Sem `skipAuthRetry`: se o access token estiver vencido, um 401 aqui deve
 * disparar a renovação automática do `httpClient` e reexecutar — ver nota
 * de `WITH_CREDENTIALS` acima.
 */
export function me(): Promise<SessionUser> {
  return httpClient.get<SessionUser>(AUTH_PATHS.me, { credentials: 'include' });
}

export const authApi = { register, login, refresh, logout, me };
