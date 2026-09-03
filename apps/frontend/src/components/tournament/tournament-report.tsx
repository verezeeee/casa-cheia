'use client';

import type {
  MoneyString,
  TournamentReportRankingItemDto,
  TournamentReportResponse,
} from '@poker-system/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { tournamentApi } from '@/lib/api/tournament';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { formatCountdown, formatDateTimeSafe, formatMoneySafe } from '@/lib/format';
import { ApiError } from '@/lib/http-client';
import { buildTournamentReportCsv, tournamentReportCsvFilename } from '@/lib/report-csv';
import { TOURNAMENT_STATUS_VARIANT } from '@/lib/tournament-status';

/** Placeholder único para "não se aplica"/"não existe" em todo o relatório. */
const DASH = '—';

/**
 * `formatMoneySafe`/`formatDateTimeSafe` já devolvem `DASH` para entrada
 * corrompida, mas a assinatura delas é `string` — e boa parte deste payload é
 * legitimamente `null` (prêmio fora da faixa premiada, campeão sem
 * `eliminatedAt`, torneio sem garantia, torneio anterior a `RT-DB-01` sem
 * `startedAt`). Estes dois wrappers absorvem o `null` ANTES da chamada em vez
 * de afrouxar o contrato dos formatadores compartilhados.
 */
function money(value: MoneyString | null | undefined): string {
  return value == null ? DASH : formatMoneySafe(value);
}

function dateTime(value: string | null | undefined): string {
  return value == null ? DASH : formatDateTimeSafe(value);
}

/**
 * Duração como `h:mm:ss`. `durationMs` é `null` quando falta `finishedAt`
 * (torneio nunca encerrado); `formatCountdown` já tolera `NaN`, então não há
 * caminho de "NaN:NaN" aqui.
 */
function duration(durationMs: number | null | undefined): string {
  return durationMs == null ? DASH : formatCountdown(durationMs);
}

/** `null` de um contador é ausência de dado (relógio nunca rodou), não zero. */
function count(value: number | null | undefined): string {
  return value == null ? DASH : String(value);
}

/**
 * Overlay > 0 significa que a casa teria de cobrir a diferença para honrar a
 * garantia. Comparação numérica (não aritmética) sobre a string decimal só
 * para decidir se a nota aparece — o valor exibido continua vindo do backend
 * sem passar por `Number`.
 */
function isPositiveMoney(value: MoneyString | null | undefined): boolean {
  if (value == null) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

/**
 * Baixa o CSV do relatório (`RT-FE-04`).
 *
 * Impuro (toca `document`/`URL`) e por isso declarado FORA do componente, na
 * mesma disciplina de `lateRegistrationOpen` em `tournament-detail.tsx`: o
 * lint de pureza do React Compiler recusa esse tipo de chamada no corpo de
 * render. Só roda a partir de um `onClick`.
 *
 * O payload vem do cache do `useQuery` — nenhuma requisição nova (`RT-004`):
 * o relatório é imutável depois de encerrado, então exportar é serializar o
 * que já está na tela. `Blob` + `createObjectURL` + `<a download>` é o único
 * caminho de download client-side sem endpoint de arquivo no backend (que é
 * justamente a fase 2 descartada em `RT-004`).
 */
function downloadReportCsv(report: TournamentReportResponse): void {
  const blob = new Blob([buildTournamentReportCsv(report)], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = tournamentReportCsvFilename(report);

  // O nó precisa estar no documento para o clique programático valer no
  // Firefox; sai logo em seguida, e o object URL é revogado para não segurar
  // o Blob em memória pelo resto da sessão.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Relatório de fechamento do torneio (`RT-FE-02`/`RT-FE-03`).
 *
 * Sem `refetchInterval` e com `staleTime: Infinity` de propósito, ao contrário
 * de `table-map.tsx`/`clock-control.tsx`: só existe relatório de torneio
 * `FINISHED`/`CANCELLED` (`RT-002`), e as linhas de origem já são imutáveis —
 * pollar seria recalcular a mesma agregação no backend a cada 3s.
 */
export function TournamentReport({ tournamentId }: { tournamentId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tournaments', tournamentId, 'report'],
    queryFn: () => tournamentApi.getTournamentReport(tournamentId),
    staleTime: Infinity,
    // Um 400 de `RT-002` (ou um 403 de `RT-003`) é determinístico: repetir a
    // requisição só atrasa a mensagem que o usuário já vai ver.
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  // 400 é o único erro com significado de produto aqui: o backend recusa o
  // relatório enquanto o torneio não foi encerrado (`RT-002`). Cair no
  // "não foi possível carregar" genérico faria o staff procurar problema de
  // rede onde só falta encerrar o torneio.
  if (error instanceof ApiError && error.statusCode === 400) {
    return (
      <ErrorState
        title="Relatório indisponível"
        description="Este torneio ainda não foi encerrado."
      />
    );
  }
  if (error || !data) {
    return <ErrorState description="Não foi possível carregar o relatório." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* `print:hidden`: os próprios botões não fazem sentido no papel — e o
          "Salvar PDF" é a caixa de impressão do navegador, então eles
          apareceriam no preview do documento que estão gerando. O resto do
          chrome de navegação (`Sidebar`/`TopBar`/`BottomNav`/voltar) recebe a
          mesma classe nos próprios componentes, já que é montado pelo
          `RequireAuth`, fora desta página. */}
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Button variant="secondary" size="sm" onClick={() => downloadReportCsv(data)}>
          Exportar CSV
        </Button>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          Imprimir / Salvar PDF
        </Button>
      </div>

      <ReportHeader report={data} />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
        <NumbersCard report={data} />
        <FinancialsCard report={data} />
      </div>

      <RankingCard ranking={data.ranking} />
    </div>
  );
}

/** Linha de `dl`: rótulo à esquerda, valor monetário/numérico à direita. */
function Row({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-ledger text-right text-sm">
        {value}
        {note && <span className="block text-xs font-normal text-muted">{note}</span>}
      </dd>
    </div>
  );
}

function ReportHeader({ report }: { report: TournamentReportResponse }) {
  const { stats } = report;
  // Sem `startedAt` o horário exibido é o AGENDADO — rotulado como estimado
  // para não passar por fato (um torneio que atrasou 40 min apareceria
  // começando 40 min antes do que começou).
  const startLabel = stats.startedAt
    ? dateTime(stats.startedAt)
    : `${dateTime(report.startsAt)}${stats.durationEstimated ? ' (estimado)' : ''}`;

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold">{report.name}</p>
          <p className="font-ledger text-sm text-muted">
            Buy-in {money(report.buyIn)} + {money(report.fee)}
          </p>
        </div>
        <Badge variant={TOURNAMENT_STATUS_VARIANT[report.status]}>{report.status}</Badge>
      </div>

      <dl className="mt-3 flex flex-col gap-1">
        <Row label="Início" value={startLabel} />
        <Row label="Fim" value={dateTime(stats.finishedAt)} />
        <Row
          label="Duração"
          value={duration(stats.durationMs)}
          note={stats.durationMs != null && stats.durationEstimated ? 'estimada' : undefined}
        />
      </dl>
    </Card>
  );
}

function NumbersCard({ report }: { report: TournamentReportResponse }) {
  const { stats } = report;

  return (
    <Card title="Números do torneio">
      <dl className="flex flex-col gap-1">
        <Row label="Inscritos" value={count(stats.totalEntries)} />
        <Row label="Jogadores únicos" value={count(stats.uniquePlayers)} />
        {/* Não existe rebuy/add-on neste domínio: `reentries` é
            `totalEntries - uniquePlayers` (ver `RT-SH-01`). */}
        <Row label="Reentradas" value={count(stats.reentries)} />
        <Row label="Cancelamentos" value={count(stats.refundedEntries)} />
        <Row label="Bônus de staff pagos" value={count(stats.staffBonusesPaid)} />
        <Row label="Mesas usadas" value={count(stats.tablesUsed)} />
        <Row label="Último nível" value={count(stats.lastLevelNumber)} />
      </dl>
    </Card>
  );
}

function FinancialsCard({ report }: { report: TournamentReportResponse }) {
  const { stats } = report;

  return (
    <Card title="Financeiro">
      <dl className="flex flex-col gap-1">
        <Row label="Prize pool" value={money(stats.prizePool)} />
        <Row label="Total pago" value={money(stats.totalPaidOut)} />
        <Row label="Saldo não pago" value={money(stats.unpaidPrizePool)} />
        <Row label="Garantido" value={money(stats.guaranteedPrize)} />
        <Row
          label="Overlay"
          value={money(stats.overlay)}
          note={isPositiveMoney(stats.overlay) ? 'coberto pela casa' : undefined}
        />
        <Row label="Receita de taxa" value={money(stats.feeRevenue)} />
        <Row label="Receita de bônus" value={money(stats.staffBonusRevenue)} />
        <Row label="Receita total da casa" value={money(stats.houseRevenue)} />
      </dl>
    </Card>
  );
}

function RankingCard({ ranking }: { ranking: TournamentReportRankingItemDto[] }) {
  // O backend já entrega em `position` ascendente; reordenar (em cópia, sem
  // mutar o cache do React Query) custa nada e a tela deixa de depender disso.
  const ordered = [...ranking].sort((a, b) => a.position - b.position);

  return (
    <Card title="Ranking final">
      {ordered.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma inscrição disputou este torneio.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {ordered.map((item) => (
            <li key={item.entryId} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <span className="font-ledger w-10 shrink-0 text-sm text-muted">{item.position}º</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.userName}</p>
                <p className="flex flex-wrap gap-x-2 text-xs text-muted">
                  <span>{dateTime(item.eliminatedAt)}</span>
                  {/* Marcadores discretos: a maioria das colocações de um
                      torneio real é DERIVED (só as faixas premiadas exigem
                      `finalPosition`), então isso não pode competir com o
                      nome do jogador. */}
                  {item.positionSource === 'DERIVED' && <span>posição inferida</span>}
                  {item.isReentry && <span>reentrada</span>}
                </p>
              </div>
              <span className="font-ledger shrink-0 text-sm">{money(item.prizeAmount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
