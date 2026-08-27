import type { Metadata } from 'next';
import { BlindDisplay } from '@/components/tournament/blind-display';

/**
 * TV do salão. FORA de `RequireAuth`/`AuthLayout` de propósito: a rota de
 * leitura é pública e a TV não faz login. Sem `TopBar`/`BottomNav` — a tela
 * inteira é o relógio.
 */
export const metadata: Metadata = {
  title: 'Blinds · Casa Cheia',
};

export default async function TournamentDisplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <BlindDisplay tournamentId={id} />;
}
