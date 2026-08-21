'use client';

import { useEffect } from 'react';

/**
 * Registra o service worker (public/sw.js) no cliente após o carregamento
 * da página. Componente sem UI - apenas efeito colateral.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      // Evita cache agressivo do SW atrapalhando o hot-reload em dev.
      return;
    }

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
        console.error('Falha ao registrar o service worker:', error);
      });
    });
  }, []);

  return null;
}
