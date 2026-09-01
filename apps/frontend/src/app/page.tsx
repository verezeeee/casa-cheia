import { AuthStatus } from '@/components/auth/auth-status';
import { ApiStatus } from '@/components/health/api-status';
import { Logo } from '@/components/layout/logo';
import { Reveal, RevealItem } from '@/components/ui';

const FEATURES: Array<{ label: string; description: string }> = [
  { label: 'Carteira', description: 'Saldo, depósito e saque com extrato completo.' },
  { label: 'Mesas', description: 'Buy-in, cash-out e resultado de mão registrados na hora.' },
  { label: 'Torneios', description: 'Inscrição, eliminação e premiação com um clique.' },
];

export default function Home() {
  return (
    <>
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <Logo className="text-lg" iconSize={20} />
        <AuthStatus />
      </header>

      <main className="flex flex-1 flex-col bg-brand text-brand-foreground">
        <Reveal
          as="div"
          className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center gap-6 px-4 py-14 sm:px-6 sm:py-20"
        >
          <RevealItem as="div">
            <p className="font-mono text-xs tracking-[0.2em] text-accent uppercase">
              Gestão de casa de poker
            </p>
          </RevealItem>
          <RevealItem as="div">
            <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
              O caixa da sua casa de poker.
            </h1>
          </RevealItem>
          <RevealItem as="div">
            <p className="max-w-xl text-lg text-brand-foreground/80">
              Carteira, mesas de cash game e torneios — tudo num só lugar, com trilha de auditoria
              completa de cada centavo que entra ou sai da mesa.
            </p>
          </RevealItem>
          <RevealItem as="div" className="w-full">
            <Reveal as="ul" className="mt-4 grid w-full gap-6 sm:grid-cols-3">
              {FEATURES.map((feature) => (
                <RevealItem key={feature.label} as="li" className="ledger-rule group">
                  <p className="font-display text-lg font-semibold">{feature.label}</p>
                  <p className="mt-1 text-sm text-brand-foreground/70 transition-colors duration-200 group-hover:text-brand-foreground/90">
                    {feature.description}
                  </p>
                </RevealItem>
              ))}
            </Reveal>
          </RevealItem>
        </Reveal>
      </main>

      <footer className="flex items-center justify-center border-t border-border px-4 py-3 sm:px-6">
        <ApiStatus />
      </footer>
    </>
  );
}
