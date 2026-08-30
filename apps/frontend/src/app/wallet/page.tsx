import { RequireAuth } from '@/components/auth/require-auth';
import { BalanceCard } from '@/components/wallet/balance-card';
import { DepositForm } from '@/components/wallet/deposit-form';
import { TransactionList } from '@/components/wallet/transaction-list';
import { WithdrawalForm } from '@/components/wallet/withdrawal-form';

export default function WalletPage() {
  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6 lg:max-w-4xl lg:p-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Carteira</h1>
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_1.3fr] lg:items-start">
          <div className="flex flex-col gap-6">
            <BalanceCard />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
              <DepositForm />
              <WithdrawalForm />
            </div>
          </div>
          <TransactionList />
        </div>
      </main>
    </RequireAuth>
  );
}
