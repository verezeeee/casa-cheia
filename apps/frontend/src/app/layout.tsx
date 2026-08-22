import type { Metadata, Viewport } from 'next';
import { Fustat, IBM_Plex_Mono, Inter_Tight } from 'next/font/google';
import { MotionProvider } from '@/components/providers/motion-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { SessionProvider } from '@/components/providers/session-provider';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import './globals.css';

/**
 * Sistema tipográfico alinhado ao design system do AbacatePay (ver tokens de
 * cor em globals.css):
 * - Fustat: destaque — títulos, navegação, botões, número do saldo.
 * - Inter Tight: corpo — legível em formulários e telas densas.
 * - IBM Plex Mono: dados tabulares (dinheiro, fichas, datas) com
 *   `tabular-nums`, para colunas alinharem como um livro-caixa de verdade —
 *   conceito próprio do produto, fora do escopo do AbacatePay (site sem
 *   tabela de dados), mantido porque ainda é a escolha certa aqui.
 */
const displayFont = Fustat({
  variable: '--font-display',
  subsets: ['latin'],
});

const bodyFont = Inter_Tight({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const monoFont = IBM_Plex_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Casa Cheia',
  description: 'Plataforma de poker online - cash games e torneios.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Casa Cheia',
  },
  icons: {
    icon: [
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e2e7f1' },
    { media: '(prefers-color-scheme: dark)', color: '#12201f' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <MotionProvider>
          <QueryProvider>
            <SessionProvider>
              {children}
              <ServiceWorkerRegister />
            </SessionProvider>
          </QueryProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
