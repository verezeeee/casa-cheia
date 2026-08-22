'use client';

import { useSession } from '@/components/providers/session-provider';
import { Button, Spinner, TextLink } from '@/components/ui';

/** Indicador de sessão + ações de entrar/sair, usado no cabeçalho das páginas públicas. */
export function AuthStatus() {
  const { status, user, logout } = useSession();

  if (status === 'loading') {
    return <Spinner size="sm" />;
  }

  if (status === 'unauthenticated') {
    return (
      <div className="flex items-center gap-3 text-sm">
        <TextLink href="/login">Entrar</TextLink>
        <TextLink href="/register">Cadastrar</TextLink>
      </div>
    );
  }

  // Navegação entre seções fica no `BottomNav` das páginas autenticadas —
  // aqui (só a home pública) o essencial é entrar e sair, sem repetir os
  // mesmos links (que não caberiam numa tela de 375px).
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden text-muted sm:inline">Olá, {user?.name}</span>
      <TextLink href="/lobby">Ir para o lobby</TextLink>
      <Button variant="secondary" size="sm" onClick={() => void logout()}>
        Sair
      </Button>
    </div>
  );
}
