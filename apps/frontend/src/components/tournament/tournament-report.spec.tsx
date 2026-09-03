import { TournamentEntryStatus, TournamentStatus } from '@poker-system/shared';
import type { TournamentReportResponse } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { tournamentApi } from '@/lib/api/tournament';
import { ApiError } from '@/lib/http-client';
import { TournamentReport } from './tournament-report';

jest.mock('@/lib/api/tournament', () => ({
  tournamentApi: {
    getTournamentReport: jest.fn(),
  },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockReport(report: TournamentReportResponse): void {
  (tournamentApi.getTournamentReport as jest.Mock).mockResolvedValue(report);
}

const FULL_REPORT: TournamentReportResponse = {
  tournamentId: 'trn-1',
  name: 'Sunday Major',
  status: TournamentStatus.FINISHED,
  buyIn: '90.00',
  fee: '10.00',
  staffBonusCost: '20.00',
  startsAt: '2026-08-30T23:00:00.000Z',
  stats: {
    totalEntries: 3,
    uniquePlayers: 2,
    reentries: 1,
    refundedEntries: 1,
    staffBonusesPaid: 2,
    tablesUsed: 2,
    lastLevelNumber: 12,
    prizePool: '270.00',
    totalPaidOut: '250.00',
    unpaidPrizePool: '20.00',
    guaranteedPrize: '500.00',
    overlay: '230.00',
    feeRevenue: '30.00',
    staffBonusRevenue: '40.00',
    houseRevenue: '70.00',
    startedAt: '2026-08-30T23:12:00.000Z',
    finishedAt: '2026-08-31T02:12:00.000Z',
    durationMs: 3 * 60 * 60 * 1000,
    durationEstimated: false,
  },
  prizes: [
    { position: 1, percentage: '70.00' },
    { position: 2, percentage: '30.00' },
  ],
  ranking: [
    {
      entryId: 'entry-a',
      userId: 'u-1',
      userName: 'Ana',
      position: 1,
      positionSource: 'RECORDED',
      finalPosition: 1,
      prizeAmount: '175.00',
      status: TournamentEntryStatus.PAID,
      registeredAt: '2026-08-30T22:00:00.000Z',
      eliminatedAt: null,
      staffBonusPaid: true,
      isReentry: false,
    },
    {
      entryId: 'entry-b',
      userId: 'u-2',
      userName: 'Bruno',
      position: 2,
      positionSource: 'RECORDED',
      finalPosition: 2,
      prizeAmount: '75.00',
      status: TournamentEntryStatus.PAID,
      registeredAt: '2026-08-30T22:05:00.000Z',
      eliminatedAt: '2026-08-31T02:05:00.000Z',
      staffBonusPaid: false,
      isReentry: false,
    },
    {
      entryId: 'entry-c',
      userId: 'u-2',
      userName: 'Bruno',
      position: 3,
      positionSource: 'DERIVED',
      finalPosition: null,
      prizeAmount: null,
      status: TournamentEntryStatus.ELIMINATED,
      registeredAt: '2026-08-30T22:40:00.000Z',
      eliminatedAt: '2026-08-31T01:00:00.000Z',
      staffBonusPaid: true,
      isReentry: true,
    },
  ],
  generatedAt: '2026-09-03T12:00:00.000Z',
};

/**
 * Torneio anterior ao MVP de mesas e a `RT-DB-01`: sem `startedAt`, sem mesas,
 * relógio nunca rodou, sem garantia e sem nada pago. É o payload que faz
 * "NaN"/"Invalid Date" aparecer se algum formatador for chamado com `null`.
 */
const LEGACY_REPORT: TournamentReportResponse = {
  ...FULL_REPORT,
  staffBonusCost: null,
  stats: {
    ...FULL_REPORT.stats,
    totalEntries: 0,
    uniquePlayers: 0,
    reentries: 0,
    refundedEntries: 0,
    staffBonusesPaid: 0,
    tablesUsed: 0,
    lastLevelNumber: null,
    prizePool: '0.00',
    totalPaidOut: '0.00',
    unpaidPrizePool: '0.00',
    guaranteedPrize: null,
    overlay: null,
    feeRevenue: '0.00',
    staffBonusRevenue: '0.00',
    houseRevenue: '0.00',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    durationEstimated: true,
  },
  ranking: [],
};

describe('TournamentReport', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('renderiza cabeçalho, números, financeiro e ranking do payload completo', async () => {
    mockReport(FULL_REPORT);

    renderWithClient(<TournamentReport tournamentId="trn-1" />);

    await waitFor(() => expect(screen.getByText('Sunday Major')).toBeInTheDocument());
    expect(tournamentApi.getTournamentReport).toHaveBeenCalledWith('trn-1');

    // Cabeçalho: status, buy-in + fee, início REAL (não o agendado), fim, duração.
    expect(screen.getByText('FINISHED')).toBeInTheDocument();
    expect(screen.getByText('Buy-in R$ 90,00 + R$ 10,00')).toBeInTheDocument();
    expect(screen.getByText('30/08/2026, 20:12')).toBeInTheDocument();
    expect(screen.getByText('30/08/2026, 23:12')).toBeInTheDocument();
    expect(screen.getByText('3:00:00')).toBeInTheDocument();
    expect(screen.queryByText(/estimado/)).not.toBeInTheDocument();

    // Números do torneio.
    const numbers = screen.getByText('Números do torneio').parentElement!;
    expect(numbers).toHaveTextContent('Reentradas1');
    expect(numbers).toHaveTextContent('Cancelamentos1');
    expect(numbers).toHaveTextContent('Bônus de staff pagos2');
    expect(numbers).toHaveTextContent('Mesas usadas2');
    expect(numbers).toHaveTextContent('Último nível12');

    // Financeiro.
    const financials = screen.getByText('Financeiro').parentElement!;
    expect(financials).toHaveTextContent('Prize poolR$ 270,00');
    expect(financials).toHaveTextContent('Saldo não pagoR$ 20,00');
    expect(financials).toHaveTextContent('Receita total da casaR$ 70,00');
    // Overlay positivo: a casa teria de cobrir a diferença da garantia.
    expect(screen.getByText('coberto pela casa')).toBeInTheDocument();

    // Ranking.
    expect(screen.getByText('1º')).toBeInTheDocument();
    expect(screen.getByText('R$ 175,00')).toBeInTheDocument();
    expect(screen.getByText('posição inferida')).toBeInTheDocument();
    expect(screen.getByText('reentrada')).toBeInTheDocument();
  });

  it('ordena o ranking por posição mesmo se o payload vier fora de ordem', async () => {
    mockReport({ ...FULL_REPORT, ranking: [...FULL_REPORT.ranking].reverse() });

    renderWithClient(<TournamentReport tournamentId="trn-1" />);

    await waitFor(() => expect(screen.getByText('1º')).toBeInTheDocument());
    const positions = screen.getAllByText(/^\d+º$/).map((el) => el.textContent);
    expect(positions).toEqual(['1º', '2º', '3º']);
  });

  it('payload legado (sem startedAt/mesas/nível) não gera NaN nem Invalid Date', async () => {
    mockReport(LEGACY_REPORT);

    renderWithClient(<TournamentReport tournamentId="trn-1" />);

    await waitFor(() => expect(screen.getByText('Sunday Major')).toBeInTheDocument());

    // Sem `startedAt`: mostra o AGENDADO rotulado como estimado.
    expect(screen.getByText('30/08/2026, 20:00 (estimado)')).toBeInTheDocument();

    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toContain('NaN');
    expect(rendered).not.toContain('Invalid Date');

    // Ausências viram "—", nunca "R$ 0,00" inventado nem "null".
    expect(rendered).not.toContain('null');
    const numbers = screen.getByText('Números do torneio').parentElement!;
    expect(numbers).toHaveTextContent('Último nível—');
    const financials = screen.getByText('Financeiro').parentElement!;
    expect(financials).toHaveTextContent('Garantido—');
    expect(financials).toHaveTextContent('Overlay—');
    expect(screen.queryByText('coberto pela casa')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhuma inscrição disputou este torneio.')).toBeInTheDocument();
  });

  it('overlay zerado não mostra a nota de cobertura da casa', async () => {
    mockReport({
      ...FULL_REPORT,
      stats: { ...FULL_REPORT.stats, overlay: '0.00' },
    });

    renderWithClient(<TournamentReport tournamentId="trn-1" />);

    await waitFor(() => expect(screen.getByText('Sunday Major')).toBeInTheDocument());
    expect(screen.queryByText('coberto pela casa')).not.toBeInTheDocument();
  });

  it('400 do backend mostra a mensagem de torneio não encerrado (RT-002)', async () => {
    (tournamentApi.getTournamentReport as jest.Mock).mockRejectedValue(
      new ApiError({
        statusCode: 400,
        message: 'O relatório fica disponível quando o torneio é encerrado.',
        timestamp: '2026-09-03T12:00:00.000Z',
        path: '/clubes/c1/torneios/trn-1/report',
      }),
    );

    renderWithClient(<TournamentReport tournamentId="trn-1" />);

    await waitFor(() =>
      expect(screen.getByText('Este torneio ainda não foi encerrado.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Não foi possível carregar o relatório.')).not.toBeInTheDocument();
  });

  it('erro que não é 400 cai na mensagem genérica', async () => {
    (tournamentApi.getTournamentReport as jest.Mock).mockRejectedValue(new Error('rede'));

    renderWithClient(<TournamentReport tournamentId="trn-1" />);

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o relatório.')).toBeInTheDocument(),
    );
  });

  // `RT-FE-04`. O conteúdo do arquivo é testado em `lib/report-csv.spec.ts`
  // (função pura); aqui interessa só o encanamento de download: Blob criado a
  // partir do payload em cache (sem requisição nova), nome de arquivo certo,
  // âncora temporária clicada e removida, object URL revogado.
  it('exporta o CSV a partir do payload já em cache, sem nova requisição', async () => {
    mockReport(FULL_REPORT);
    const createObjectURL = jest.fn().mockReturnValue('blob:relatorio');
    const revokeObjectURL = jest.fn();
    // `URL.createObjectURL` não existe no jsdom — `defineProperty` em vez de
    // `spyOn`, que exigiria a propriedade já presente.
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });

    // O clique real do jsdom em `<a download>` não baixa nada; o spy também
    // captura o estado da âncora no instante do clique (depois ela é removida).
    const clicked: { href: string | null; name: string; connected: boolean } = {
      href: null,
      name: '',
      connected: false,
    };
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.href = this.getAttribute('href');
      clicked.name = this.download;
      clicked.connected = this.isConnected;
    });

    try {
      renderWithClient(<TournamentReport tournamentId="trn-1" />);
      const button = await screen.findByRole('button', { name: 'Exportar CSV' });

      fireEvent.click(button);

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(clicked.href).toBe('blob:relatorio');
      expect(clicked.name).toBe('relatorio-sunday-major-2026-09-03.csv');
      // Firefox só honra clique programático em nó ligado ao documento.
      expect(clicked.connected).toBe(true);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:relatorio');
      // Nada de âncora órfã sobrando no documento depois do download.
      expect(document.querySelector('a[download]')).toBeNull();
      // Exportar não refaz a leitura: o relatório é imutável (`RT-004`).
      expect(tournamentApi.getTournamentReport).toHaveBeenCalledTimes(1);
    } finally {
      clickSpy.mockRestore();
    }
  });

  it('clique em imprimir chama window.print', async () => {
    mockReport(FULL_REPORT);
    const print = jest.fn();
    Object.defineProperty(window, 'print', { value: print, configurable: true, writable: true });

    renderWithClient(<TournamentReport tournamentId="trn-1" />);
    const button = await screen.findByRole('button', { name: 'Imprimir / Salvar PDF' });

    fireEvent.click(button);

    expect(print).toHaveBeenCalledTimes(1);
  });

  it('esconde a barra de ações na impressão', async () => {
    mockReport(FULL_REPORT);

    renderWithClient(<TournamentReport tournamentId="trn-1" />);
    const button = await screen.findByRole('button', { name: 'Exportar CSV' });

    // Os botões não podem sair no papel — nem no preview do "Salvar PDF" que
    // eles próprios abrem.
    expect(button.parentElement).toHaveClass('print:hidden');
  });

  it('não oferece exportação quando o relatório não carregou', async () => {
    (tournamentApi.getTournamentReport as jest.Mock).mockRejectedValue(new Error('rede'));

    renderWithClient(<TournamentReport tournamentId="trn-1" />);

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o relatório.')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Imprimir / Salvar PDF' })).not.toBeInTheDocument();
  });

  it('estado de carregamento renderiza esqueleto sem quebrar', () => {
    (tournamentApi.getTournamentReport as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { container } = renderWithClient(<TournamentReport tournamentId="trn-1" />);

    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
