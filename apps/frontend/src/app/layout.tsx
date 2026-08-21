import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { QueryProvider } from '@/components/providers/query-provider';
import { SessionProvider } from '@/components/providers/session-provider';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import './globals.css';

/**
 * Sistema tipográfico (ver design tokens em globals.css):
 * - Fraunces: serifada de destaque — títulos e o número do saldo, o único
 *   lugar onde a personalidade visual "fala alto".
 * - IBM Plex Sans: interface/corpo — legível em formulários e telas densas.
 * - IBM Plex Mono: dados tabulares (dinheiro, fichas, datas) com
 *   `tabular-nums`, para colunas alinharem como um livro-caixa de verdade.
 */
const displayFont = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  axes: ['opsz', 'SOFT', 'WONK'],
});

const bodyFont = IBM_Plex_Sans({
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
  title: 'Poker System',
  description: 'Plataforma de poker online - cash games e torneios.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Poker System',
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
  themeColor: '#14110d',
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
        <QueryProvider>
          <SessionProvider>
            {children}
            <ServiceWorkerRegister />
          </SessionProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
