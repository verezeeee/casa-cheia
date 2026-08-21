'use client';

import { useQuery } from '@tanstack/react-query';
import { walletApi } from '@/lib/api/wallet';
import { Card, Spinner } from '@/components/ui';
import { formatMoneySafe } from '@/lib/format';

export function BalanceCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: walletApi.getBalance,
  });

  return (
    <Card>
      <p className="text-sm text-slate-600 dark:text-slate-400">Saldo disponível</p>
      {isLoading ? (
        <Spinner size="sm" label="Carregando saldo" />
      ) : isError || !data ? (
        <p className="text-red-600 dark:text-red-400">Não foi possível carregar o saldo.</p>
      ) : (
        <p className="text-3xl font-semibold tracking-tight">{formatMoneySafe(data.balance)}</p>
      )}
    </Card>
  );
}
