'use client';

import { UserRole } from '@poker-system/shared';
import { RequireAuth } from '@/components/auth/require-auth';
import { useSession } from '@/components/providers/session-provider';
import { CreateTableForm } from '@/components/table/create-table-form';
import { TableList } from '@/components/table/table-list';

function LobbyContent() {
  const { user } = useSession();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Lobby</h1>
      {/* Fora da linha do título de propósito: quando aberto, o formulário
          vira um Card cheio — dividir a largura com o <h1> na mesma linha
          espremeria os dois lados num celular. O <div> (bloco, não item de
          flex-col) impede que o botão "+ Criar mesa" (fechado) estique para
          a largura inteira por herdar `align-items: stretch` do <main>. */}
      {user?.role === UserRole.ADMIN && (
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
