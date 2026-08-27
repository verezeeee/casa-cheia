import { BackLink } from '@/components/ui';

export interface PageHeaderProps {
  title: string;
  /** Quando presente, mostra um botão de voltar contextual antes do título. */
  backHref?: string;
}

/**
 * Cabeçalho padrão das sub-rotas que pendem de uma aba do `BottomNav` — não
 * usar nas 3 abas primárias (lobby/torneios/carteira), que não têm "voltar"
 * natural e já contam com a nav inferior (ver docblock de `TopBar`).
 * Extraído depois que o mesmo `<h1>` se repetiu em 5 páginas sem nenhuma
 * delas oferecer um jeito de voltar contextual.
 */
export function PageHeader({ title, backHref }: PageHeaderProps) {
  return (
    <div className="flex items-center gap-2">
      {backHref && <BackLink href={backHref} />}
      <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
    </div>
  );
}
