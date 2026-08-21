'use client';

import Link from 'next/link';
import { useSession } from '@/components/providers/session-provider';
import { Button, Spinner } from '@/components/ui';

/** Indicador de sessão + ações de entrar/sair, usado no cabeçalho das páginas públicas. */
export function AuthStatus() {
  const { status, user, logout } = useSession();

  if (status === 'loading') {
    return <Spinner size="sm" />;
  }

  if (status === 'unauthenticated') {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Link href="/login" className="font-medium text-accent hover:underline">
          Entrar
        </Link>
        <Link href="/register" className="font-medium text-accent hover:underline">
          Cadastrar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted">Olá, {user?.name}</span>
      <Link href="/lobby" className="font-medium text-accent hover:underline">
        Lobby
      </Link>
      <Link href="/tournaments" className="font-medium text-accent hover:underline">
        Torneios
      </Link>
      <Link href="/wallet" className="font-medium text-accent hover:underline">
        Carteira
      </Link>
      <Button variant="secondary" size="sm" onClick={() => void logout()}>
        Sair
      </Button>
    </div>
  );
}
