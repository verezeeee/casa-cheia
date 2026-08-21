import { RequireAuth } from '@/components/auth/require-auth';
import { BalanceCard } from '@/components/wallet/balance-card';
import { DepositForm } from '@/components/wallet/deposit-form';
import { TransactionList } from '@/components/wallet/transaction-list';
import { WithdrawalForm } from '@/components/wallet/withdrawal-form';

export default function WalletPage() {
  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Carteira</h1>
        <BalanceCard />
        <div className="grid gap-6 sm:grid-cols-2">
          <DepositForm />
          <WithdrawalForm />
        </div>
        <TransactionList />
      </main>
    </RequireAuth>
  );
}
