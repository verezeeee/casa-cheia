import { AuthStatus } from '@/components/auth/auth-status';
import { ApiStatus } from '@/components/health/api-status';

export default function Home() {
  return (
    <>
      <header className="flex items-center justify-end p-4">
        <AuthStatus />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Poker System</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Bootstrap do monorepo - backend, frontend PWA e infraestrutura.
          </p>
        </div>
        <ApiStatus />
      </main>
    </>
  );
}
