'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';
import { createQueryClient } from '@/lib/query-client';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState garante uma única instância de QueryClient por sessão do
  // navegador (não recriada a cada render), evitando perder o cache.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV !== 'production' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
