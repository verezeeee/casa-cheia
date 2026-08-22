'use client';

import type { WalletTransactionDto } from '@poker-system/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { walletApi } from '@/lib/api/wallet';
import { Badge, Card, EmptyState, ErrorState, Skeleton, type BadgeVariant } from '@/components/ui';
import { formatDateTimeSafe, formatMoneySafe } from '@/lib/format';

const TYPE_LABEL: Record<WalletTransactionDto['type'], string> = {
  PIX_DEPOSIT: 'Depósito PIX',
  PIX_WITHDRAWAL: 'Saque PIX',
  TABLE_BUY_IN: 'Buy-in de mesa',
  TABLE_CASH_OUT: 'Cash-out de mesa',
  TOURNAMENT_BUY_IN: 'Inscrição em torneio',
  TOURNAMENT_PAYOUT: 'Premiação de torneio',
  ADJUSTMENT: 'Ajuste administrativo',
};

const STATUS_VARIANT: Record<WalletTransactionDto['status'], BadgeVariant> = {
  PENDING: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger',
  REVERSED: 'neutral',
};

export function TransactionList() {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['wallet', 'transactions'],
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        walletApi.getTransactions(pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card title="Extrato">
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState description="Não foi possível carregar o extrato." />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nenhuma movimentação ainda"
          description="Seus depósitos e saques aparecem aqui."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="divide-y divide-border">
            {items.map((transaction) => (
              <li
                key={transaction.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{TYPE_LABEL[transaction.type]}</p>
                  <p className="text-xs text-muted">{formatDateTimeSafe(transaction.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[transaction.status]}>{transaction.status}</Badge>
                  <span
                    className={
                      transaction.amount.startsWith('-')
                        ? 'font-ledger font-semibold text-danger'
                        : 'font-ledger font-semibold text-success'
                    }
                  >
                    {formatMoneySafe(transaction.amount)}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {hasNextPage && (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="self-center text-sm font-medium text-accent transition-colors duration-200 hover:underline disabled:opacity-60"
            >
              {isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
