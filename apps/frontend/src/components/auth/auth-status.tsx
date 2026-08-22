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

  // Navegação entre seções fica no `BottomNav` das páginas autenticadas —
  // aqui (só a home pública) o essencial é entrar e sair, sem repetir os
  // mesmos links (que não caberiam numa tela de 375px).
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden text-muted sm:inline">Olá, {user?.name}</span>
      <Link href="/lobby" className="font-medium text-accent hover:underline">
        Ir para o lobby
      </Link>
      <Button variant="secondary" size="sm" onClick={() => void logout()}>
        Sair
      </Button>
    </div>
  );
}
