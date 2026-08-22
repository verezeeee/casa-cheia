import { Spade } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { Logo } from './logo';

/**
 * Layout das telas de auth (login/registro): painel de marca à esquerda em
 * `md:`+ (o card de formulário sozinho, centralizado, é o padrão certo pra
 * auth — não "center bias" genérico — mas com dois idênticos em telas
 * grandes a página fica vazia demais; o painel ocupa esse espaço com
 * identidade em vez de só esticar o card). Em `< md` colapsa pro card único.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] flex-1 flex-col md:flex-row">
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-brand p-10 text-brand-foreground md:flex">
        <Spade
          weight="fill"
          size={420}
          className="pointer-events-none absolute -right-24 -bottom-24 text-white/5"
          aria-hidden="true"
        />
        <Logo iconSize={22} className="relative text-xl" />
        <div className="relative max-w-sm">
          <p className="font-display text-3xl font-semibold text-balance">
            O caixa da sua casa de poker.
          </p>
          <p className="mt-3 text-sm text-brand-foreground/70">
            Carteira, PIX, mesas de cash game e torneios — tudo com trilha de auditoria completa de
            cada centavo.
          </p>
        </div>
        <p className="relative text-xs text-brand-foreground/50">
          © {new Date().getFullYear()} Casa Cheia
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-background p-4 sm:p-8">
        {children}
      </div>
    </main>
  );
}
