import type { MoneyString, TournamentReportResponse } from '@poker-system/shared';
import { formatCountdown, formatDateTimeSafe } from './format';

/**
 * Serialização do relatório de torneio em CSV (`RT-FE-04`).
 *
 * Módulo PURO: recebe o payload que o `useQuery` de `tournament-report.tsx` já
 * carregou e devolve uma string. Nenhuma API de browser (`Blob`,
 * `URL.createObjectURL`, `<a download>`) entra aqui — o download é do
 * componente. É o que permite testar o FORMATO do arquivo (escape, separador,
 * decimal) sem mock de DOM, e o que mantém a regra de "exportação é
 * client-side, sem requisição nova" (`RT-004`) em um lugar só.
 *
 * Decisões de formato, todas para o Excel em pt-BR (é onde o fechamento do
 * clube é conferido, não em um parser genérico):
 *
 * 1. **Separador `;`** — o Excel pt-BR usa `;` como delimitador de lista;
 *    arquivo com `,` abre tudo em uma coluna só.
 * 2. **Decimal com vírgula** — os valores monetários chegam do backend como
 *    string decimal (`"360.00"`, espelhando o `Decimal` do banco). A troca é
 *    textual (`.` → `,`), NUNCA `Number(...)` + reformatação: passar dinheiro
 *    por float é exatamente o que o contrato `MoneyString` existe para evitar.
 *    Sem símbolo de moeda e sem separador de milhar, para a célula chegar como
 *    NÚMERO no Excel e continuar somável.
 * 3. **BOM UTF-8 na string retornada** (não no chamador) — sem ele o Excel lê
 *    o arquivo como Latin-1 e "Duração"/"Bônus" chegam quebrados. Fica aqui de
 *    propósito: quem chama só embrulha a string em um `Blob`, e o
 *    conhecimento de "este texto é um CSV para Excel" não se divide em dois
 *    arquivos.
 * 4. **`null` vira campo VAZIO**, não `"—"` — o travessão é decisão de TELA
 *    (`tournament-report.tsx`), onde o espaço em branco pareceria bug. Em
 *    planilha, célula vazia é a representação correta de "não se aplica" e
 *    não contamina uma coluna numérica com texto.
 * 5. **Datas pelo mesmo formatador da tela** (`formatDateTimeSafe`, fuso fixo
 *    America/Sao_Paulo) — o CSV precisa bater com o que o admin viu na tela;
 *    ISO em UTC obrigaria conferência mental de fuso.
 */

/** Delimitador do Excel pt-BR (ver decisão 1 no docblock do módulo). */
const SEPARATOR = ';';

/** CRLF: é o que a RFC 4180 manda e o que o Excel espera. */
const EOL = '\r\n';

/** BOM UTF-8 (ver decisão 3). */
const BOM = '\uFEFF';

/**
 * Campos que precisam de aspas segundo a RFC 4180: o próprio separador, a
 * aspa dupla e quebras de linha. Nome de torneio ("Sunday «Major»; 2ª etapa")
 * e nome de jogador digitado por humano passam por aqui.
 */
const NEEDS_QUOTING = /[;"\r\n]/;

function escapeField(value: string): string {
  if (!NEEDS_QUOTING.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function row(fields: readonly (string | number)[]): string {
  return fields.map((field) => escapeField(String(field))).join(SEPARATOR) + EOL;
}

/** Ver decisão 2: troca textual do separador decimal, sem aritmética. */
function money(value: MoneyString | null): string {
  return value == null ? '' : value.replace('.', ',');
}

function dateTime(value: string | null): string {
  // Fallback vazio (e não "—") também para data corrompida: ver decisão 4.
  return value == null ? '' : formatDateTimeSafe(value, '');
}

function duration(durationMs: number | null): string {
  return durationMs == null ? '' : formatCountdown(durationMs);
}

function bool(value: boolean): string {
  return value ? 'Sim' : 'Não';
}

function count(value: number | null): string {
  return value == null ? '' : String(value);
}

/**
 * CSV do relatório: um bloco `chave;valor` com o cabeçalho e todas as
 * estatísticas, uma linha em branco, e o ranking em forma de tabela.
 *
 * Duas seções no MESMO arquivo (em vez de dois downloads) porque o documento
 * de fechamento é um só: quem confere o financeiro precisa ver na mesma
 * planilha quanto entrou de taxa e quem levou prêmio.
 */
export function buildTournamentReportCsv(report: TournamentReportResponse): string {
  const { stats } = report;

  const statsBlock: string[] = [
    row(['Campo', 'Valor']),
    row(['Torneio', report.name]),
    row(['Status', report.status]),
    row(['Buy-in', money(report.buyIn)]),
    row(['Taxa', money(report.fee)]),
    row(['Bônus de staff', money(report.staffBonusCost)]),
    row(['Início agendado', dateTime(report.startsAt)]),
    // `startedAt` é o início REAL; vazio em torneio anterior a `RT-DB-01` ou
    // cancelado antes de começar — daí a linha "Duração estimada" ao lado, sem
    // a qual a duração passaria por fato medido.
    row(['Início real', dateTime(stats.startedAt)]),
    row(['Fim', dateTime(stats.finishedAt)]),
    row(['Duração', duration(stats.durationMs)]),
    row(['Duração estimada', bool(stats.durationEstimated)]),
    row(['Inscritos', count(stats.totalEntries)]),
    row(['Jogadores únicos', count(stats.uniquePlayers)]),
    // Não existe rebuy/add-on neste domínio: reentrada é
    // `totalEntries - uniquePlayers` (ver `RT-SH-01`).
    row(['Reentradas', count(stats.reentries)]),
    row(['Cancelamentos', count(stats.refundedEntries)]),
    row(['Bônus de staff pagos', count(stats.staffBonusesPaid)]),
    row(['Mesas usadas', count(stats.tablesUsed)]),
    row(['Último nível', count(stats.lastLevelNumber)]),
    row(['Prize pool', money(stats.prizePool)]),
    row(['Total pago', money(stats.totalPaidOut)]),
    row(['Saldo não pago', money(stats.unpaidPrizePool)]),
    row(['Garantido', money(stats.guaranteedPrize)]),
    row(['Overlay', money(stats.overlay)]),
    row(['Receita de taxa', money(stats.feeRevenue)]),
    row(['Receita de bônus', money(stats.staffBonusRevenue)]),
    row(['Receita total da casa', money(stats.houseRevenue)]),
    row(['Relatório gerado em', dateTime(report.generatedAt)]),
  ];

  // Mesma ordenação da tela: o backend já entrega em `position` ascendente, e
  // uma cópia ordenada custa nada (nunca mutar o cache do React Query).
  const ranking = [...report.ranking].sort((a, b) => a.position - b.position);

  const rankingBlock: string[] = [
    row(['Posição', 'Jogador', 'Prêmio', 'Status', 'Eliminação', 'Reentrada', 'Posição inferida']),
    ...ranking.map((item) =>
      row([
        item.position,
        item.userName,
        money(item.prizeAmount),
        item.status,
        dateTime(item.eliminatedAt),
        bool(item.isReentry),
        // `DERIVED` = colocação inferida pela ordem de eliminação, não
        // digitada pelo staff. Marcar isso no arquivo é o que separa o
        // documento de fechamento de um palpite.
        bool(item.positionSource === 'DERIVED'),
      ]),
    ),
  ];

  // Ranking vazio (torneio cancelado antes da 1ª inscrição) mantém o cabeçalho
  // da tabela: o arquivo continua CSV válido e legível, com zero linhas.
  return BOM + statsBlock.join('') + EOL + rankingBlock.join('');
}

/**
 * `relatorio-<slug>-<yyyy-mm-dd>.csv`.
 *
 * A data vem de `generatedAt` (do payload), não de `new Date()`: o nome do
 * arquivo passa a ser função pura do relatório — testável e igual para dois
 * downloads do mesmo payload.
 */
export function tournamentReportCsvFilename(report: TournamentReportResponse): string {
  return `relatorio-${slugify(report.name)}-${isoDate(report.generatedAt)}.csv`;
}

/**
 * Mesmo fuso fixo de `lib/format.ts` (a operação é brasileira): a data do nome
 * do arquivo tem de ser o dia que o admin viu na tela, não o dia em UTC — um
 * relatório exportado às 22h de Brasília cairia no dia seguinte.
 * `en-CA` é o atalho de locale que já produz `yyyy-mm-dd`.
 */
const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

function isoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'sem-data' : isoDateFormatter.format(date);
}

/**
 * Nome do torneio → pedaço de nome de arquivo: sem acento, minúsculo, espaços
 * e pontuação viram hífen. Acento e `/` em nome de arquivo quebram download em
 * parte dos navegadores/sistemas de arquivo; um nome inteiro de emoji viraria
 * string vazia, daí o fallback.
 */
function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'torneio';
}
