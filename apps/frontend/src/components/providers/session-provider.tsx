'use client';

import type { ClubeRole, SessionUser } from '@poker-system/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '@/lib/api/auth';
import { clubApi, setCurrentClubeId } from '@/lib/api/club-context';
import type { LoginRequest } from '@/lib/api/types';
import { setAccessToken, setUnauthorizedHandler } from '@/lib/http-client';

/**
 * Resolve o clube "atual" da sessão (MVP de clube único — ver `club-context.ts`)
 * assim que sabemos quem é o usuário, junto do papel dele NESTE clube
 * (`ClubeMembership.role` não existe mais em `SessionUser` — ver seu
 * docblock). Uma conta sem nenhum clube (ainda não convidada) fica com
 * `currentClubeId`/`clubeRole` nulos: as chamadas a mesa/torneio/carteira vão
 * falhar explicitamente em vez de usar um clube errado.
 */
async function resolveCurrentClube(): Promise<ClubeRole | null> {
  const clubes = await clubApi.listMyClubes();
  const current = clubes[0] ?? null;
  setCurrentClubeId(current?.id ?? null);
  return current?.role ?? null;
}

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface SessionContextValue {
  user: SessionUser | null;
  /** Papel do usuário no clube atual (`ClubeSummaryDto.role`) — `null` fora de `authenticated` ou sem clube. */
  clubeRole: ClubeRole | null;
  status: SessionStatus;
  login: (input: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Provider de sessão (T-FE-02, ver `lib/api/auth.ts`).
 *
 * Guarda o `SessionUser` em estado de React e o access token SOMENTE em
 * memória via `setAccessToken` (nunca `localStorage` — o roubo por XSS fica
 * limitado à sessão da aba atual, não persiste). A sessão sobrevive a um
 * reload da página porque o refresh token continua no cookie httpOnly: na
 * hidratação, chamamos `me()` sem access token — o 401 resultante aciona o
 * handler de renovação abaixo, que troca o cookie por um access token novo
 * e o `httpClient` reexecuta `me()` automaticamente (ver `lib/http-client.ts`).
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [clubeRole, setClubeRole] = useState<ClubeRole | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setCurrentClubeId(null);
    setUser(null);
    setClubeRole(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    // Registrado ANTES da chamada de hidratação abaixo (mesmo efeito, ordem
    // síncrona) para que o primeiro 401 de `me()` já encontre o handler.
    // Vale para qualquer 401 futuro da aplicação inteira, não só o boot.
    setUnauthorizedHandler(async () => {
      try {
        const { accessToken } = await authApi.refresh();
        setAccessToken(accessToken);
        return accessToken;
      } catch {
        clearSession();
        return null;
      }
    });

    authApi
      .me()
      .then(async (sessionUser) => {
        setClubeRole(await resolveCurrentClube());
        setUser(sessionUser);
        setStatus('authenticated');
      })
      .catch(() => {
        // Se a renovação (handler acima) já rodou, `clearSession` já marcou
        // `unauthenticated`; isso cobre também erro de rede/sem sessão.
        setStatus((current) => (current === 'loading' ? 'unauthenticated' : current));
      });

    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const login = useCallback(async (input: LoginRequest) => {
    const { accessToken } = await authApi.login(input);
    setAccessToken(accessToken);
    const sessionUser = await authApi.me();
    setClubeRole(await resolveCurrentClube());
    setUser(sessionUser);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, clubeRole, status, login, logout }),
    [user, clubeRole, status, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession precisa ser usado dentro de <SessionProvider>.');
  }
  return ctx;
}
