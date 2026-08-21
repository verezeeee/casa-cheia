// Service worker mínimo do Poker System PWA.
//
// Decisão técnica: implementado à mão (sem next-pwa/workbox) porque, no
// momento deste bootstrap, o app usa Next.js 16 com Turbopack e as
// integrações de PWA baseadas em plugin webpack (next-pwa) não são
// garantidamente compatíveis com o pipeline do Turbopack. Um service
// worker simples e explícito evita essa incerteza e é fácil de trocar por
// Workbox/Serwist depois, se o app crescer em complexidade offline.
//
// Estratégia:
// - App shell (documento "/", manifest, ícones, estáticos do Next) -> cache-first
// - Chamadas de API (mesma origem ou NEXT_PUBLIC_API_URL) -> network-first,
//   nunca cacheadas de forma persistente (dados sensíveis a saldo/carteira).
const CACHE_VERSION = 'poker-system-shell-v1';
const APP_SHELL = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Nunca cachear chamadas de API - sempre buscar dados frescos da rede.
  if (isApiRequest(url) || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    }),
  );
});
