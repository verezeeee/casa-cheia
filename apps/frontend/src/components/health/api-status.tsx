'use client';

import type { HealthCheckResponse } from '@poker-system/shared';
import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/http-client';

/**
 * Pequeno indicador de conectividade com o backend, usado como smoke test
 * visual de que o TanStack Query + cliente HTTP centralizado estão
 * corretamente ligados a NEXT_PUBLIC_API_URL.
 */
export function ApiStatus() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: () => httpClient.get<HealthCheckResponse>('/health'),
    refetchInterval: 30_000,
  });

  const status = isLoading ? 'checking' : error ? 'down' : (data?.status ?? 'unknown');

  const styles: Record<string, string> = {
    checking: 'bg-muted',
    ok: 'bg-success',
    down: 'bg-danger',
    unknown: 'bg-muted',
  };

  const label: Record<string, string> = {
    checking: 'Verificando API...',
    ok: 'API online',
    down: 'API indisponível',
    unknown: 'Status desconhecido',
  };

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${styles[status]}`} aria-hidden />
      <span>{label[status]}</span>
    </div>
  );
}
