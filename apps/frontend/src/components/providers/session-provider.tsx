'use client';

import type { ClubeRole, ClubeSummaryDto, SessionUser } from '@poker-system/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { authApi } from '@/lib/api/auth';
import { clubApi, setCurrentClubeId } from '@/lib/api/club-context';
import type { LoginRequest } from '@/lib/api/types';
import { ApiError, setAccessToken, setUnauthorizedHandler } from '@/lib/http-client';

/** Onde a escolha de clube do usuário sobrevive a um reload da página. */
const CURRENT_CLUBE_STORAGE_KEY = 'casa-cheia:currentClubeId';

function readStoredClubeId(): string | null {
  try {
    return localStorage.getItem(CURRENT_CLUBE_STORAGE_KEY);
  } catch {
    return null; // Privado/bloqueado: cai no default (primeiro clube da lista).
  }
}

function storeClubeId(clubeId: string | null): void {
  try {
    if (clubeId) localStorage.setItem(CURRENT_CLUBE_STORAGE_KEY, clubeId);
    else localStorage.removeItem(CURRENT_CLUBE_STORAGE_KEY);
  } catch {
    // Sem storage disponível: a escolha só dura a aba atual, sem quebrar nada.
  }
}

/**
 * Busca os clubes do usuário e decide qual é o "atual": o salvo em
 * `localStorage` SE ele ainda estiver na lista (clube revogado/saído não
 * conta), senão o primeiro (`clubes[0]`, mesmo critério de antes de existir
 * seletor). Uma conta sem clube nenhum (recém-cadastrada, ou ainda não
 * convidada) fica com `currentClubeId` nulo — `RequireAuth` mostra a tela de
 * "sem clube" nesse caso em vez de deixar as chamadas de mesa/torneio/
 * carteira falharem tentando usar um clube que não existe.
 */
async function resolveClubes(): Promise<{
  clubes: ClubeSummaryDto[];
  currentClubeId: string | null;
}> {
  const clubes = await clubApi.listMyClubes();
  const stored = readStoredClubeId();
  const current = clubes.find((c) => c.id === stored) ?? clubes[0] ?? null;
  setCurrentClubeId(current?.id ?? null);
  return { clubes, currentClubeId: current?.id ?? null };
}

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface SessionContextValue {
  user: SessionUser | null;
  /** Papel do usuário no clube atual — `null` fora de `authenticated` ou sem clube. */
  clubeRole: ClubeRole | null;
  /** Todos os clubes ativos do usuário — alimenta o seletor da sidebar. */
  clubes: ClubeSummaryDto[];
  currentClubeId: string | null;
  status: SessionStatus;
  login: (input: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** Troca o clube atual (seletor da sidebar). Refaz toda query club-scoped. */
  switchClube: (clubeId: string) => void;
  /** Re-busca a lista de clubes — usado depois de criar/entrar num clube pela UI. */
  refreshClubes: () => Promise<void>;
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
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [clubes, setClubes] = useState<ClubeSummaryDto[]>([]);
  const [currentClubeId, setCurrentClubeIdState] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  // Guarda contra respostas atrasadas de uma tentativa de autenticação
  // ANTIGA sobrescrevendo o resultado de uma mais nova — ver `login` e o
  // `useEffect` de hidratação abaixo. Ref (não state): só precisa ser lido
  // de forma síncrona dentro dos callbacks assíncronos, nunca dispara
  // re-render sozinho.
  const attemptRef = useRef(0);
  const beginAttempt = useCallback(() => ++attemptRef.current, []);
  const isCurrentAttempt = useCallback((attempt: number) => attemptRef.current === attempt, []);

  // Derivado, não estado próprio: papel do usuário no clube atual. Guardar
  // separado arriscaria os dois dessincronizarem (ex. trocar de clube e
  // esquecer de atualizar o papel junto).
  const clubeRole = useMemo(
    () => clubes.find((c) => c.id === currentClubeId)?.role ?? null,
    [clubes, currentClubeId],
  );

  const applyClubes = useCallback(
    (resolved: { clubes: ClubeSummaryDto[]; currentClubeId: string | null }) => {
      setClubes(resolved.clubes);
      setCurrentClubeIdState(resolved.currentClubeId);
    },
    [],
  );

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setCurrentClubeId(null);
    setUser(null);
    setClubes([]);
    setCurrentClubeIdState(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    const attempt = beginAttempt();

    // Registrado ANTES da chamada de hidratação abaixo (mesmo efeito, ordem
    // síncrona) para que o primeiro 401 de `me()` já encontre o handler.
    // Vale para qualquer 401 futuro da aplicação inteira, não só o boot —
    // por isso captura o `attempt` corrente NO MOMENTO em que É CHAMADO (não
    // o `attempt` da hidratação): pode disparar bem depois do mount, em
    // resposta a qualquer 401 posterior.
    setUnauthorizedHandler(async () => {
      const attemptAtCall = attemptRef.current;
      try {
        const { accessToken } = await authApi.refresh();
        // Só aplica se nada mais recente aconteceu enquanto o refresh estava
        // em voo (ex.: um `login()` explícito que já terminou) — sem essa
        // checagem, um refresh atrasado usando um cookie velho/já rotacionado
        // podia derrubar (`clearSession`) uma sessão nova recém-autenticada,
        // ou sobrescrever o access token dela com um antigo.
        if (isCurrentAttempt(attemptAtCall)) {
          setAccessToken(accessToken);
        }
        return accessToken;
      } catch (error) {
        // Só encerra a sessão quando o backend CONFIRMA (401) que o refresh
        // token não é mais válido. Qualquer outra falha — rede caiu, timeout
        // de 15s (`http-client.ts`), 5xx/cold start do backend serverless —
        // é transitória e NÃO significa que a sessão expirou de verdade.
        // Sem essa distinção, um soluço passageiro ao clicar numa ação no
        // meio do uso (access token vencido, refresh tenta renovar e esbarra
        // num timeout/500) derrubava a sessão do mesmo jeito que um refresh
        // token realmente inválido — a ação em si falha (o chamador original
        // recebe o 401 dele normalmente), mas o usuário continua logado e
        // pode simplesmente tentar de novo.
        const sessionReallyInvalid = error instanceof ApiError && error.statusCode === 401;
        if (sessionReallyInvalid && isCurrentAttempt(attemptAtCall)) {
          clearSession();
        }
        return null;
      }
    });

    authApi
      .me()
      .then(async (sessionUser) => {
        const resolved = await resolveClubes();
        if (!isCurrentAttempt(attempt)) return;
        applyClubes(resolved);
        setUser(sessionUser);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!isCurrentAttempt(attempt)) return;
        // Se a renovação (handler acima) já rodou, `clearSession` já marcou
        // `unauthenticated`; isso cobre também erro de rede/sem sessão.
        setStatus((current) => (current === 'loading' ? 'unauthenticated' : current));
      });

    return () => setUnauthorizedHandler(null);
  }, [applyClubes, beginAttempt, clearSession, isCurrentAttempt]);

  const login = useCallback(
    async (input: LoginRequest) => {
      // Invalida qualquer tentativa de hidratação/refresh ainda em voo — a
      // partir daqui, só o resultado DESTE login pode escrever no estado de
      // sessão. Sem isso, uma resposta atrasada da hidratação (ex.: um
      // refresh usando um cookie já expirado) podia chegar DEPOIS deste
      // login ter dado certo e jogar o usuário de volta pro /login mesmo com
      // credenciais corretas.
      const attempt = beginAttempt();
      const { accessToken } = await authApi.login(input);
      // Mesma guarda no caso raro de duplo-clique disparando dois `login()`
      // concorrentes: só o mais recente escreve o access token do módulo
      // HTTP, senão a resposta do mais antigo podia chegar depois e
      // sobrescrever o token válido do mais novo.
      if (!isCurrentAttempt(attempt)) return;
      setAccessToken(accessToken);
      const sessionUser = await authApi.me();
      const resolved = await resolveClubes();
      if (!isCurrentAttempt(attempt)) return;
      applyClubes(resolved);
      setUser(sessionUser);
      setStatus('authenticated');
    },
    [applyClubes, beginAttempt, isCurrentAttempt],
  );

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    clearSession();
  }, [clearSession]);

  const switchClube = useCallback(
    (clubeId: string) => {
      setCurrentClubeId(clubeId);
      setCurrentClubeIdState(clubeId);
      storeClubeId(clubeId);
      // As query keys hoje (`['tables']`, `['tournaments']`, ...) não levam
      // `clubeId` — invalidar tudo é o jeito simples de garantir que nenhuma
      // tela fique mostrando dado do clube anterior. Trocar de clube é ação
      // rara, não precisa ser cirúrgico.
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const refreshClubes = useCallback(async () => {
    applyClubes(await resolveClubes());
  }, [applyClubes]);

  const value = useMemo(
    () => ({
      user,
      clubeRole,
      clubes,
      currentClubeId,
      status,
      login,
      logout,
      switchClube,
      refreshClubes,
    }),
    [user, clubeRole, clubes, currentClubeId, status, login, logout, switchClube, refreshClubes],
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
