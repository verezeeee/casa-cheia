import { TournamentEntryStatus, TournamentStatus } from '@poker-system/shared';
import type { TournamentReportResponse } from '@poker-system/shared';
import { buildTournamentReportCsv, tournamentReportCsvFilename } from './report-csv';

const REPORT: TournamentReportResponse = {
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
      prizeAmount: '1750.50',
      status: TournamentEntryStatus.PAID,
      registeredAt: '2026-08-30T22:00:00.000Z',
      eliminatedAt: null,
      staffBonusPaid: true,
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
  ],
  generatedAt: '2026-09-03T12:00:00.000Z',
};

/** Ajuda a asserir sobre uma linha específica sem depender do índice dela. */
function lines(csv: string): string[] {
  return csv.replace(/^\uFEFF/, '').split('\r\n');
}

function lineStartingWith(csv: string, prefix: string): string {
  const found = lines(csv).find((line) => line.startsWith(prefix));
  if (found === undefined) throw new Error(`Linha "${prefix}" não encontrada no CSV.`);
  return found;
}

describe('buildTournamentReportCsv', () => {
  it('serializa o payload completo com separador ";", CRLF e BOM UTF-8', () => {
    const csv = buildTournamentReportCsv(REPORT);

    // BOM: sem ele o Excel abre "Duração"/"Bônus" como mojibake.
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(lineStartingWith(csv, 'Torneio')).toBe('Torneio;Sunday Major');
    expect(lineStartingWith(csv, 'Status')).toBe('Status;FINISHED');
    expect(lineStartingWith(csv, 'Inscritos')).toBe('Inscritos;3');
    expect(lineStartingWith(csv, 'Reentradas')).toBe('Reentradas;1');
    expect(lineStartingWith(csv, 'Mesas usadas')).toBe('Mesas usadas;2');
    expect(lineStartingWith(csv, 'Último nível')).toBe('Último nível;12');
    expect(lineStartingWith(csv, 'Duração;')).toBe('Duração;3:00:00');
    expect(lineStartingWith(csv, 'Duração estimada')).toBe('Duração estimada;Não');
    // Datas no mesmo formato/fuso da tela (America/Sao_Paulo), não ISO em UTC.
    expect(lineStartingWith(csv, 'Início real')).toBe('Início real;30/08/2026, 20:12');
  });

  it('usa vírgula decimal nos valores de dinheiro, sem símbolo nem milhar', () => {
    const csv = buildTournamentReportCsv(REPORT);

    expect(lineStartingWith(csv, 'Buy-in')).toBe('Buy-in;90,00');
    expect(lineStartingWith(csv, 'Prize pool')).toBe('Prize pool;270,00');
    expect(lineStartingWith(csv, 'Receita total da casa')).toBe('Receita total da casa;70,00');
    // Os dígitos são os do backend: nada de "R$" e nada de separador de
    // milhar (que colidiria com o próprio decimal em pt-BR).
    expect(csv).toContain(';1750,50;');
    expect(csv).not.toContain('R$');
    expect(csv).not.toContain('1.750');
  });

  it('escreve as duas seções separadas por uma linha em branco', () => {
    const csv = buildTournamentReportCsv(REPORT);
    const all = lines(csv);
    const headerIndex = all.findIndex((line) => line.startsWith('Posição;'));

    expect(headerIndex).toBeGreaterThan(0);
    expect(all[headerIndex - 1]).toBe('');
    expect(all[headerIndex]).toBe(
      'Posição;Jogador;Prêmio;Status;Eliminação;Reentrada;Posição inferida',
    );
  });

  it('emite o ranking em posição ascendente, com marcadores de reentrada e posição inferida', () => {
    const csv = buildTournamentReportCsv(REPORT);
    const rankingRows = lines(csv).filter((line) => /^\d+;/.test(line));

    expect(rankingRows).toEqual([
      // Campeão: sem `eliminatedAt` (campo vazio, não "—").
      '1;Ana;1750,50;PAID;;Não;Não',
      '2;Bruno;75,00;PAID;30/08/2026, 23:05;Não;Não',
      '3;Bruno;;ELIMINATED;30/08/2026, 22:00;Sim;Sim',
    ]);
  });

  it('escapa ";", aspas e quebra de linha conforme a RFC 4180', () => {
    const csv = buildTournamentReportCsv({
      ...REPORT,
      name: 'Sunday "Major"; 2ª etapa',
      ranking: [
        {
          ...REPORT.ranking[0],
          userName: 'Ana\nMaria; a "Fria"',
        },
      ],
    });

    // Campo com aspas/separador: envolto em aspas duplas, aspas internas
    // duplicadas.
    expect(lineStartingWith(csv, 'Torneio')).toBe('Torneio;"Sunday ""Major""; 2ª etapa"');
    // A quebra de linha vive DENTRO do campo citado: a linha lógica do CSV
    // continua depois dela.
    expect(csv).toContain('1;"Ana\nMaria; a ""Fria""";1750,50;PAID;;Não;Não\r\n');
  });

  it('campos null viram célula vazia, sem "null"/"NaN"/"undefined"', () => {
    const csv = buildTournamentReportCsv({
      ...REPORT,
      staffBonusCost: null,
      stats: {
        ...REPORT.stats,
        guaranteedPrize: null,
        overlay: null,
        lastLevelNumber: null,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        durationEstimated: true,
      },
      ranking: [{ ...REPORT.ranking[0], prizeAmount: null, eliminatedAt: null }],
    });

    expect(lineStartingWith(csv, 'Bônus de staff;')).toBe('Bônus de staff;');
    expect(lineStartingWith(csv, 'Garantido')).toBe('Garantido;');
    expect(lineStartingWith(csv, 'Overlay')).toBe('Overlay;');
    expect(lineStartingWith(csv, 'Último nível')).toBe('Último nível;');
    expect(lineStartingWith(csv, 'Início real')).toBe('Início real;');
    expect(lineStartingWith(csv, 'Fim')).toBe('Fim;');
    expect(lineStartingWith(csv, 'Duração;')).toBe('Duração;');
    expect(lineStartingWith(csv, 'Duração estimada')).toBe('Duração estimada;Sim');
    expect(lineStartingWith(csv, '1;')).toBe('1;Ana;;PAID;;Não;Não');
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('NaN');
    expect(csv).not.toContain('undefined');
    // O travessão é decisão de TELA; em planilha, célula vazia.
    expect(csv).not.toContain('—');
  });

  it('data corrompida no payload não vira "Invalid Date" na planilha', () => {
    const csv = buildTournamentReportCsv({
      ...REPORT,
      startsAt: 'nao-e-data',
      stats: { ...REPORT.stats, finishedAt: '' },
    });

    expect(lineStartingWith(csv, 'Início agendado')).toBe('Início agendado;');
    expect(lineStartingWith(csv, 'Fim')).toBe('Fim;');
    expect(csv).not.toContain('Invalid Date');
  });

  it('ranking vazio ainda produz CSV válido — só estatísticas e o cabeçalho da tabela', () => {
    const csv = buildTournamentReportCsv({ ...REPORT, ranking: [] });
    const all = lines(csv);

    expect(lineStartingWith(csv, 'Torneio')).toBe('Torneio;Sunday Major');
    expect(all.filter((line) => /^\d+;/.test(line))).toEqual([]);
    expect(all[all.length - 1]).toBe('');
    expect(all[all.length - 2]).toBe(
      'Posição;Jogador;Prêmio;Status;Eliminação;Reentrada;Posição inferida',
    );
  });
});

describe('tournamentReportCsvFilename', () => {
  it('usa o slug do nome e a data de geração do relatório', () => {
    expect(tournamentReportCsvFilename(REPORT)).toBe('relatorio-sunday-major-2026-09-03.csv');
  });

  it('normaliza acento, pontuação e espaços repetidos no slug', () => {
    expect(tournamentReportCsvFilename({ ...REPORT, name: 'Ação  de Sábado — 2ª/etapa!' })).toBe(
      'relatorio-acao-de-sabado-2-etapa-2026-09-03.csv',
    );
  });

  it('cai em "torneio" quando o nome não sobra nenhum caractere utilizável', () => {
    expect(tournamentReportCsvFilename({ ...REPORT, name: '★ ★' })).toBe(
      'relatorio-torneio-2026-09-03.csv',
    );
  });

  it('usa o fuso da operação para a data, não UTC', () => {
    // 03/09 às 00:30 UTC ainda é 02/09 em São Paulo — o arquivo tem de levar
    // o dia que o admin viu na tela.
    expect(
      tournamentReportCsvFilename({ ...REPORT, generatedAt: '2026-09-03T00:30:00.000Z' }),
    ).toBe('relatorio-sunday-major-2026-09-02.csv');
  });

  it('não quebra com generatedAt corrompido', () => {
    expect(tournamentReportCsvFilename({ ...REPORT, generatedAt: 'xx' })).toBe(
      'relatorio-sunday-major-sem-data.csv',
    );
  });
});
