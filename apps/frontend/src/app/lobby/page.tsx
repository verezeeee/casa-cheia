'use client';

import { ClubeRole } from '@poker-system/shared';
import { useQuery } from '@tanstack/react-query';
import { RequireAuth } from '@/components/auth/require-auth';
import { useSession } from '@/components/providers/session-provider';
import { CreateTableForm } from '@/components/table/create-table-form';
import { TableList } from '@/components/table/table-list';
import { tableApi } from '@/lib/api/table';

/**
 * Resume o estado geral das mesas acima da lista — texto solto com
 * `ledger-rule`, não um `Card` (métricas não precisam de caixa própria
 * quando já estão isoladas por espaço, ver seção de densidade da skill de
 * design). Consulta a mesma `queryKey` de `TableList`: cache compartilhado
 * do react-query, sem requisição duplicada.
 */
function LobbySummary() {
  const { data } = useQuery({
    queryKey: ['tables'],
    queryFn: () => tableApi.listTables(),
  });

  if (!data) return null;

  const open = data.items.filter((table) => table.status === 'OPEN').length;
  const openSeats = data.items.reduce(
    (sum, table) => sum + Math.max(0, table.maxSeats - table.occupiedSeats),
    0,
  );

  return (
    <p className="ledger-rule text-sm text-muted">
      {open} {open === 1 ? 'mesa aberta' : 'mesas abertas'} · {openSeats}{' '}
      {openSeats === 1 ? 'vaga disponível' : 'vagas disponíveis'}
    </p>
  );
}

function LobbyContent() {
  const { clubeRole } = useSession();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Mesas</h1>
        <LobbySummary />
      </div>
      {/* Fora da linha do título de propósito: quando aberto, o formulário
          vira um Card cheio — dividir a largura com o <h1> na mesma linha
          espremeria os dois lados num celular. O <div> (bloco, não item de
          flex-col) impede que o botão "+ Criar mesa" (fechado) estique para
          a largura inteira por herdar `align-items: stretch` do <main>. */}
      {clubeRole === ClubeRole.ADMIN && (
        <div>
          <CreateTableForm />
        </div>
      )}
      <TableList />
    </main>
  );
}

export default function LobbyPage() {
  return (
    <RequireAuth>
      <LobbyContent />
    </RequireAuth>
  );
}
