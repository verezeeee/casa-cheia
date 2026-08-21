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
 * Congelado para evitar mutação acidental por um chamador.
 */
const WITH_CREDENTIALS: RequestOptions = Object.freeze({ credentials: 'include' });

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

/** Usuário autenticado no momento, segundo o backend. */
export function me(): Promise<SessionUser> {
  return httpClient.get<SessionUser>(AUTH_PATHS.me, WITH_CREDENTIALS);
}

export const authApi = { register, login, refresh, logout, me };
