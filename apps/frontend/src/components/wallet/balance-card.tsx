'use client';

import { Spade } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { walletApi } from '@/lib/api/wallet';
import { Spinner } from '@/components/ui';
import { formatMoneySafe } from '@/lib/format';

/**
 * O momento de assinatura da identidade visual: o saldo é a informação mais
 * importante da tela, então ganha tratamento próprio (fundo baize, não o
 * `bg-surface` padrão do `Card`) — por isso um `div` dedicado em vez de
 * `<Card className="bg-brand">`, que criaria duas classes `bg-*` competindo
 * pela mesma propriedade com a mesma especificidade.
 */
export function BalanceCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: walletApi.getBalance,
  });

  return (
    <div className="rounded-md border border-border bg-brand p-4 text-brand-foreground shadow-sm">
      <p className="font-mono text-xs tracking-[0.15em] text-brand-foreground/70 uppercase">
        Saldo disponível
      </p>
      {isLoading ? (
        <Spinner size="sm" label="Carregando saldo" />
      ) : isError || !data ? (
        <p className="text-danger">Não foi possível carregar o saldo.</p>
      ) : (
        <p className="font-display font-ledger mt-1 flex items-center gap-1.5 text-4xl font-semibold tracking-tight">
          <Spade weight="fill" size={28} className="text-accent" aria-hidden="true" />
          {formatMoneySafe(data.balance)}
        </p>
      )}
    </div>
  );
}
