import { RequireAuth } from '@/components/auth/require-auth';
import { BalanceCard } from '@/components/wallet/balance-card';
import { TransactionList } from '@/components/wallet/transaction-list';

export default function WalletPage() {
  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6 lg:max-w-4xl lg:p-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Carteira</h1>
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_1.3fr] lg:items-start">
          <div className="flex flex-col gap-6">
            <BalanceCard />
            {/* Depósito/saque via PIX (DepositForm/WithdrawalForm) removidos
                daqui por enquanto — gateway (AbacatePay) em standby, ver
                docblock de WalletService.createDeposit no backend. */}
            <p className="text-sm text-muted">
              Depósitos e saques via PIX estão temporariamente indisponíveis.
            </p>
          </div>
          <TransactionList />
        </div>
      </main>
    </RequireAuth>
  );
}
