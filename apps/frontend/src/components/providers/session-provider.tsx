'use client';

import type { SessionUser } from '@poker-system/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '@/lib/api/auth';
import type { LoginRequest } from '@/lib/api/types';
import { setAccessToken, setUnauthorizedHandler } from '@/lib/http-client';

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface SessionContextValue {
  user: SessionUser | null;
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
  const [status, setStatus] = useState<SessionStatus>('loading');

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
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
      .then((sessionUser) => {
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
    setUser(sessionUser);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    clearSession();
  }, [clearSession]);

  const value = useMemo(() => ({ user, status, login, logout }), [user, status, login, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession precisa ser usado dentro de <SessionProvider>.');
  }
  return ctx;
}
