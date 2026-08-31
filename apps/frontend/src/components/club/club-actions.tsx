'use client';

import type { ClubeSummaryDto } from '@poker-system/shared';
import { useState } from 'react';
import { Button, cn } from '@/components/ui';
import { useSession } from '@/components/providers/session-provider';
import { CreateClubeDialog } from './create-clube-dialog';
import { JoinClubeDialog } from './join-clube-dialog';

export interface ClubActionsProps {
  className?: string;
}

/**
 * Os dois gatilhos "Criar clube"/"Entrar com código" + os modais que abrem.
 * Extraído do `ClubSwitcher` (sidebar) porque a tela de "sem clube" do
 * `RequireAuth` precisa exatamente das mesmas duas ações — centraliza aqui
 * pra não duplicar o estado de qual modal está aberto em dois lugares.
 */
export function ClubActions({ className }: ClubActionsProps) {
  const { switchClube, refreshClubes } = useSession();
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);

  async function handleSuccess(clube: ClubeSummaryDto) {
    await refreshClubes();
    switchClube(clube.id);
  }

  return (
    <>
      <div className={cn('flex flex-wrap gap-2', className)}>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDialog('create')}>
          + Criar clube
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDialog('join')}>
          Entrar com código
        </Button>
      </div>

      <CreateClubeDialog
        open={dialog === 'create'}
        onClose={() => setDialog(null)}
        onSuccess={(clube) => void handleSuccess(clube)}
      />
      <JoinClubeDialog
        open={dialog === 'join'}
        onClose={() => setDialog(null)}
        onSuccess={(clube) => void handleSuccess(clube)}
      />
    </>
  );
}
