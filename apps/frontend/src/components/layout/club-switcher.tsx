'use client';

import { useSession } from '@/components/providers/session-provider';
import { ClubActions } from '@/components/club/club-actions';
import { cn } from '@/components/ui';

/** Mesma aparência do `Input`; não existe `Select` no design system (ver `club-members-manager`). */
const SELECT_CLASS =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground transition-colors duration-200 hover:border-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none';

export interface ClubSwitcherProps {
  className?: string;
}

/**
 * Seletor de clube: troca (`Sidebar`, desktop) e cabeçalho mobile (`TopBar`)
 * usam o mesmo componente — as ações de criar/entrar por código não podem
 * existir só num dos dois. Um usuário pode ter vínculo `ACTIVE` com mais de
 * um clube (`ClubeMembership` é N:N) — troca aqui é o que muda
 * `currentClubeId`/`clubeRole` pro resto da sessão (`switchClube`, ver
 * `session-provider.tsx`). Os dois gatilhos abaixo (criar/entrar por código)
 * aparecem mesmo com 0 ou 1 clube — é o ponto de entrada pra criar o primeiro.
 */
export function ClubSwitcher({ className }: ClubSwitcherProps) {
  const { clubes, currentClubeId, switchClube } = useSession();

  return (
    <div className={cn('flex flex-col gap-2 border-b border-border pb-4', className)}>
      {clubes.length > 0 && (
        <select
          aria-label="Clube atual"
          className={SELECT_CLASS}
          value={currentClubeId ?? ''}
          onChange={(e) => switchClube(e.target.value)}
        >
          {clubes.map((clube) => (
            <option key={clube.id} value={clube.id}>
              {clube.name}
            </option>
          ))}
        </select>
      )}
      <ClubActions />
    </div>
  );
}
