# Relatório de Torneio Finalizado — Decomposição em tarefas

Gerado pelo agente `arquiteto` a partir da lacuna identificada em [`mesas-torneio-mvp.md`](./mesas-torneio-mvp.md) (seção "Fora de escopo do MVP" / Fase 4: "dashboard consolidado e relatórios"), com exploração real do repositório (schema Prisma, `tournament.service.ts`, `tournament-clock.service.ts`, `packages/shared`, telas do frontend, board `MT-*` existente). Convenção de ID: `RT-<CAMADA>-<NN>`.

## Status: PLANEJADO (03/09/2026) — nenhuma tarefa implementada ainda

---

## Estado atual confirmado no repo (âncoras reais)

| Afirmação | Verificado | Âncora |
|---|---|---|
| `finish` só muda status/`finishedAt` e paga a grade; devolve `getTournament()` | Confirmado | `apps/backend/src/tournament/tournament.service.ts:985-1132` (retorno em `:1131`) |
| Não existe nenhum campo agregado nem model de relatório | Confirmado | `apps/backend/prisma/schema/tournament.prisma` — nenhum `TournamentReport`/`totalRebuys` |
| **Não existe rebuy/add-on como produto.** O que existe é REENTRADA (`allowReentry`/`maxReentries`, 1 `TournamentEntry` por entrada) e bônus de staff opt-in (`staffBonusPaid`) | Confirmado | `tournament.prisma:186-188`, `:288`; `registerEntry` em `tournament.service.ts:412+` |
| **Não existe hora real de início.** `startsAt` é o AGENDADO; `clockStatus=RUNNING` não grava carimbo e `TournamentClockService.start` não toca `Tournament.status` | Confirmado | `tournament-clock.service.ts:89-115` (só escreve as 4 colunas de relógio, `:318-327`); a transição `REGISTERING→RUNNING` acontece dentro de `eliminateEntry` (`tournament.service.ts:698-701`) sem timestamp |
| `buyIn`/`fee`/`staffBonusCost` são imutáveis após a 1ª inscrição ⇒ receita é calculável por multiplicação, sem histórico por entry | Confirmado | `updateTournament` em `tournament.service.ts:167-186` |
| Cancelamento devolve `buyIn + fee (+ staffBonus)` e decrementa `prizePool` ⇒ `REFUNDED` não é receita | Confirmado | `unregisterEntry`, `tournament.service.ts:620-641` |
| Payout usa **só** `prizePool × percentage`; `guaranteedPrize` (overlay) **nunca** é aplicado no pagamento | Confirmado — lacuna real | `tournament.service.ts:1069-1072` |
| Campeão não recebe `eliminatedAt`; posições intermediárias só existem se o staff digitou `finalPosition` na eliminação | Confirmado | `eliminateEntry` (`:703-712`) + docblock de `finishTournament` (`:978-984`) |
| Índices já cobrem as consultas do relatório (`[tournamentId, status]` em entries, `@@unique([tournamentId, tableNumber])` em mesas) | Confirmado | `tournament.prisma:345`, `:502` — **nenhum índice novo é necessário** |
| Tela de detalhe é única para todos os status; sem rota/tela/export de relatório | Confirmado | `apps/frontend/src/components/tournament/tournament-detail.tsx` (badge em `:314`, prêmio em `:589-595`) |
| `@Get(':id')` do `TournamentController` NÃO é obstáculo para `:id/report` (2 segmentos, sem ambiguidade) | Confirmado | `tournament.controller.ts:88-94` |

---

## FASE 0 — Decisões (sem código; validar com o dono do produto antes do 1º commit)

### `RT-000` · Relatório é **derivado**, não materializado — bloqueia `RT-DB-*`
Não criar model `TournamentReport`/`TournamentSummary`. O relatório é calculado sob demanda a partir de `Tournament` + `TournamentEntry` + `TournamentPrize` + `TournamentTable`. Motivo: depois de `FINISHED` as linhas de origem são imutáveis; um snapshot criaria segunda fonte de verdade para dinheiro; exigiria backfill dos torneios já encerrados. Exceção única: a hora real de início não é derivável de nada hoje → vira `RT-DB-01`.
`// ponytail: se um dia o relatório virar consulta de dashboard consolidado sobre milhares de torneios (Fase 4 do PRD), materializar como view/tabela de leitura — não antes.`

### `RT-001` · Endpoint DEDICADO `GET /clubes/:clubeId/torneios/:id/report`, não o retorno de `finish`
`finish` é comando com efeito financeiro e não é repetível (segunda chamada dá 400). O relatório precisa ser consultável meses depois, por qualquer admin, N vezes.

### `RT-002` · Disponibilidade: só `FINISHED` e `CANCELLED`
`DRAFT`/`REGISTERING`/`RUNNING` → `400 "O relatório fica disponível quando o torneio é encerrado."` Durante o jogo os dados são provisórios; `CANCELLED` entra porque é documento de fechamento legítimo (quem foi reembolsado, quanto voltou).
`// ponytail: liberar leitura parcial em RUNNING se o clube pedir chip count impresso.`

### `RT-003` · Autorização: ADMIN do clube
`@Roles(ClubeRole.ADMIN)` — o payload carrega economia da casa (`feeRevenue`, `staffBonusRevenue`, `overlay`), não é dado de jogador.
`// ponytail: ranking público (sem financeiro) em GET /display/tournaments/:id/results, para a TV do salão — fase 2.`

### `RT-004` · Exportação: CSV client-side + impressão/PDF pelo navegador na fase 1; PDF server-side é fase 2
CSV gerado no browser a partir do payload já carregado (zero dependência nova); "PDF" = `print:` CSS + `window.print()`. Fase 2 só se aparecer requisito de envio automático (e-mail/WhatsApp do fechamento).

---

## FASE 1 — Banco de dados

### `RT-DB-01` · `Tournament.startedAt` + CHECK de coerência
**Dep:** `RT-000`. **Arquivo:** `prisma/schema/tournament.prisma`.
- Adicionar `startedAt DateTime? @map("started_at")` ao lado de `finishedAt`, com docblock explicando o contraste com `startsAt` (AGENDADO vs. REAL).
- Migration com `db:migrate --name tournament_started_at`, editada à mão para acrescentar:
  ```sql
  ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_finished_after_started"
    CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at");
  ```
- **Sem backfill** dos torneios já encerrados — inventar `started_at = starts_at` produziria duração falsa com cara de verdadeira.
- Nenhum índice novo.

**Aceite:** `db:migrate:deploy` limpo; `prisma validate` passa; torneio com `finished_at < started_at` recusado pelo banco.
**Testes:** cenário novo em `test/schema-invariants.int-spec.ts` (`RT-QA-03`).

---

## FASE 1 — Contratos compartilhados

### `RT-SH-01` · DTOs do relatório em `packages/shared`
**Dep:** `RT-DB-01`. **Arquivo novo:** `packages/shared/src/interfaces/tournament-report.dto.ts`, exportado em `index.ts`.

```ts
type PositionSource = 'RECORDED' | 'DERIVED';

interface TournamentReportRankingItemDto {
  entryId; userId; userName;
  position: number;
  positionSource: PositionSource;
  finalPosition: number | null;
  prizeAmount: MoneyString | null;
  status: TournamentEntryStatus;
  registeredAt: string;
  eliminatedAt: string | null;
  staffBonusPaid: boolean;
  isReentry: boolean;
}

interface TournamentReportStatsDto {
  totalEntries; uniquePlayers; reentries; refundedEntries; staffBonusesPaid; tablesUsed;
  lastLevelNumber: number | null;
  prizePool; totalPaidOut; unpaidPrizePool: MoneyString;
  guaranteedPrize: MoneyString | null; overlay: MoneyString | null;
  feeRevenue; staffBonusRevenue; houseRevenue: MoneyString;
  startedAt: string | null; finishedAt: string | null;
  durationMs: number | null; durationEstimated: boolean;
}

interface TournamentReportResponse {
  tournamentId; name; status: TournamentStatus;
  buyIn; fee; staffBonusCost: MoneyString | null;
  startsAt: string;
  stats: TournamentReportStatsDto;
  prizes: TournamentPrizeDto[];
  ranking: TournamentReportRankingItemDto[];
  generatedAt: string;
}
```

Docblocks obrigatórios: (a) não existe rebuy/add-on — `reentries = totalEntries - uniquePlayers`; (b) `overlay` é informativo, o pagamento em `finishTournament` ignora `guaranteedPrize` hoje (lacuna anotada, não corrigida aqui); (c) `durationEstimated = true` quando `startedAt` é nulo; (d) entries `REFUNDED` não entram no `ranking`.

**Aceite:** `pnpm --filter @poker-system/shared build` passa; export presente. **Testes:** `index.spec.ts`.

---

## FASE 1 — Backend

Estender `apps/backend/src/tournament/` — sem módulo novo.

### `RT-BE-01` · Carimbar `startedAt` nas duas portas de "o torneio começou"
**Dep:** `RT-DB-01`.
1. `tournament.service.ts:698-701` (`eliminateEntry`): o `updateMany({ where: { id, status: 'REGISTERING' } })` que muda para `RUNNING` passa a gravar também `startedAt: new Date()`.
2. `tournament-clock.service.ts` (`start`): gravar `startedAt` só se ainda nulo (`updateMany` condicional). **Armadilha:** o `update` genérico de `mutate` (`:318-327`) enumera colunas explicitamente por causa do bug de `MT-BE-07` — não quebrar essa disciplina.
3. Não tocar em `finishTournament`: torneio sem `startedAt` fica com duração estimada.

**Aceite:** iniciar o relógio grava `startedAt`; primeira eliminação também; segunda chamada não sobrescreve; nunca grava `startedAt > finishedAt`.
**Testes:** `tournament-clock.service.spec.ts` + `tournament.service.spec.ts`.

### `RT-BE-02` · `tournament-report.ts` — agregação e ranking como função pura
**Dep:** `RT-SH-01`. **Arquivo novo:** `apps/backend/src/tournament/tournament-report.ts`. Zero I/O — mesmo padrão de `seating.ts`.

Assinatura: `buildTournamentReport(tournament, prizes, entries, tablesUsed, now): TournamentReportResponse`.

Regras:
1. Universo do ranking: entries com `status !== 'REFUNDED'`.
2. Posição efetiva: `finalPosition` gravado vence sempre (`RECORDED`). Demais recebem posições livres de `1..N` por `eliminatedAt` DESC, `registeredAt asc`, `entryId` como desempate.
3. Dados sujos (posição duplicada/fora de faixa) são preservados como `RECORDED`, nunca lançam exceção.
4. Aritmética só em `Prisma.Decimal`: `feeRevenue = fee × totalEntries`; `staffBonusRevenue = staffBonusCost × staffBonusesPaid`; `houseRevenue = feeRevenue + staffBonusRevenue`; `totalPaidOut = Σ prizeAmount`; `unpaidPrizePool = prizePool − totalPaidOut`; `overlay = max(0, guaranteedPrize − prizePool)` ou `null`.
5. `reentries = totalEntries − uniquePlayers`; `isReentry` = não é a entry mais antiga daquele `userId`.
6. `durationMs = finishedAt − (startedAt ?? startsAt)`, `durationEstimated = startedAt === null`.

**Aceite:** nunca duas linhas com mesma posição derivada; ordenação determinística; **100% de branches** (padrão de `seating.ts`).
**Testes:** `RT-QA-01`.

### `RT-BE-03` · `TournamentService.getReport(clubeId, id)`
**Dep:** `RT-BE-02`. Ao lado de `getTournament` (`:341-368`).
- `findUnique({ where: { id, clubeId } })` → 404 se não achar.
- Guarda `RT-002`: status fora de `FINISHED|CANCELLED` → `BadRequestException`.
- `Promise.all`: prizes (ordem `position asc`), entries (com nome do usuário, ordem `registeredAt asc`), contagem de mesas (**inclui `CLOSED`** — histórico, não estado).
- Agregação em memória via `buildTournamentReport`, não `groupBy`/SQL.
- Leitura pura: sem `withClube`/transação/lock.

**Aceite:** torneio de outro clube → 404; `RUNNING` → 400; torneio legado (sem mesas/blinds/`startedAt`) → 200 com `tablesUsed: 0`, `durationEstimated: true`.
**Testes:** `tournament.service.spec.ts` + `RT-QA-02`.

### `RT-BE-04` · Rota `GET :id/report` no `TournamentController`
**Dep:** `RT-BE-03`.
```
@Get(':id/report')
@UseGuards(RolesGuard)
@Roles(ClubeRole.ADMIN)
```
Guards de classe herdados (`JwtAuthGuard, ClubeMembershipGuard`), igual a `finish`. Sem `Idempotency-Key` (é `GET`).

**Aceite:** ADMIN → 200; PLAYER membro → 403; não-membro → 404; sem token → 401; sem colisão com `@Get(':id')`.
**Testes:** `tournament.controller.spec.ts` + `RT-QA-02`.

---

## FASE 1 — Frontend

### `RT-FE-01` · Cliente de API
**Dep:** `RT-BE-04`, `RT-SH-01`. `lib/api/tournament.ts`: path `report`, `getTournamentReport(id)`, entrada em `tournamentApi`.
**Testes:** `lib/api/tournament.spec.ts`.

### `RT-FE-02` · Rota e casca da tela
**Dep:** `RT-FE-01`. `app/tournaments/[id]/report/page.tsx` (padrão de `.../tables/page.tsx`): `RequireAuth` + `PageHeader` + `<TournamentReport>`.
Componente `components/tournament/tournament-report.tsx`, `useQuery` com `staleTime: Infinity`, sem `refetchInterval` (torneio encerrado é imutável). Mensagem própria para 400 de `RT-002`.

### `RT-FE-03` · Blocos de estatística e ranking
**Dep:** `RT-FE-02`. Usando `Card`/`Badge`/`TextLink`, `formatMoneySafe`/`formatDateTimeSafe`/`formatCountdown`:
- Cabeçalho: nome, status, buy-in+fee, início real/estimado, fim, duração.
- Card "Números do torneio": inscritos, únicos, reentradas, cancelamentos, bônus pagos, mesas usadas, último nível.
- Card "Financeiro": prize pool, pago, saldo não pago, garantido+overlay, receita de taxa, receita de bônus, receita total.
- Card "Ranking final": posição, nome, prêmio, horário de eliminação, marcadores para `DERIVED`/`isReentry`.
- Extrair `STATUS_VARIANT` de `tournament-detail.tsx` para módulo compartilhado em vez de duplicar.

**Aceite:** torneio legado renderiza sem `NaN`/"Invalid Date"; prêmio nulo mostra "—".

### `RT-FE-04` · Exportar CSV + impressão
**Dep:** `RT-FE-03`, `RT-004`.
- Botão CSV: monta do payload já carregado, separador `;`, decimal com vírgula, BOM UTF-8, nome `relatorio-<slug>-<data>.csv`. Serialização em `lib/report-csv.ts` (função pura).
- Botão "Imprimir/PDF": `window.print()` + classes `print:` escondendo navegação.

**Testes:** unitário da função pura de CSV + RTL do clique (mock de `URL.createObjectURL`/`window.print`).

### `RT-FE-05` · Pontos de entrada na navegação
**Dep:** `RT-FE-02`. **Sem isto a tela nasce órfã** (mesma lacuna que virou `MT-FE-06`).
- `tournament-detail.tsx`: link "Ver relatório" quando `FINISHED|CANCELLED` e `isAdmin`.
- `finishMutation.onSuccess`: `router.push(/tournaments/:id/report)` após invalidar.
- `tournament-list.tsx`: link nos itens `FINISHED` (só admin).

**Testes:** `tournament-detail.spec.tsx` e `tournament-list.spec.tsx` (mock de `next/navigation`).

---

## FASE 1 — Testes dedicados

### `RT-QA-01` · Unitário exaustivo de `tournament-report.ts`
**Dep:** `RT-BE-02`. Casos mínimos: posições derivadas sem repetição; campeão sem `finalPosition`/`eliminatedAt`; `finalPosition` sujo (duplicado/fora de faixa); reentrada; `REFUNDED` fora do ranking; centavos que não fecham redondo; overlay acima/abaixo do arrecadado; `startedAt`/`finishedAt` nulos; torneio vazio (0 entries). **100% de branches.**

### `RT-QA-02` · e2e do endpoint (Postgres real)
**Dep:** `RT-BE-04`. Estender `test/tournament.e2e-spec.ts`: fluxo completo (cria → inscreve (com bônus, com cancelamento) → inicia relógio → elimina com posições → finish → GET report). Asserts: `totalPaidOut` igual à soma real das `WalletTransaction` TOURNAMENT_PAYOUT; `feeRevenue` desconsidera cancelada; `tablesUsed` bate com a contagem real. Autorização (403/404/401); status `RUNNING` → 400; idempotência de leitura.

### `RT-QA-03` · Integração de schema
**Dep:** `RT-DB-01`. Estender `test/schema-invariants.int-spec.ts` (CHECK de coerência) e `test/tenant-isolation.int-spec.ts` (leitura do relatório respeitando `clubeId`/RLS).

### `RT-QA-04` · RTL do frontend
**Dep:** `RT-FE-03`/`RT-FE-04`. `tournament-report.spec.tsx`: payload completo, payload legado, estado 400, ausência de dados financeiros em 403. Unitário de `lib/report-csv.ts`.

### `RT-QA-05` · E2E de browser — decisão, não implementação
Manter a decisão de `MT-QA-04`: sem Playwright. RTL + `RT-QA-02` cobrem. Validação manual no PR: encerrar torneio de teste, conferir números contra `prismaDirect`, exportar CSV, imprimir.

---

## Grafo de dependências

```
RT-000 (derivado) ─┬─> RT-DB-01 ─> RT-BE-01
                   │        └────> RT-QA-03
RT-001/002/003     └─> RT-SH-01 ─> RT-BE-02 ─> RT-BE-03 ─> RT-BE-04 ─┬─> RT-QA-02  ★ gate
                                      └─> RT-QA-01                    │
RT-004 ───────────────────────────────────────────> RT-FE-01 <────────┘
                                       RT-FE-01 ─> RT-FE-02 ─> RT-FE-03 ─┬─> RT-FE-04
                                                                         └─> RT-FE-05 ─> RT-QA-04
```

**Caminho crítico:** `RT-000` → `RT-SH-01` → `RT-BE-02` → `RT-BE-03` → `RT-BE-04` → `RT-QA-02`.

**Ordem sugerida de entrega (uma PR por bloco):**
1. `RT-DB-01` + `RT-BE-01` + `RT-QA-03` — schema, pequena e independente.
2. `RT-SH-01` — contrato.
3. `RT-BE-02` + `RT-QA-01` — função pura, onde mora todo o risco de regra.
4. `RT-BE-03` + `RT-BE-04` + `RT-QA-02` — fecha o backend.
5. `RT-FE-01` + `RT-FE-02` + `RT-FE-03` — tela.
6. `RT-FE-04` + `RT-FE-05` + `RT-QA-04` — export e navegação (não deixar para depois: sem `RT-FE-05` a tela nasce órfã).

**Portões a cada PR:** `pnpm lint`, `tsc --noEmit` nos três pacotes, `pnpm test` (unit), `test:e2e`/`test:int` nas PRs 1 e 4.

---

## Skipped deliberadamente (e quando reconsiderar)

- **Model `TournamentReport` materializado** — reconsiderar no dashboard consolidado da Fase 4.
- **PDF/CSV server-side** — reconsiderar quando houver envio automático do fechamento.
- **Ranking público na TV** — reconsiderar se o clube pedir resultado no telão.
- **Relatório parcial durante `RUNNING`**.
- **`maxConcurrentTables`, chip count final, gráfico de eliminações por nível** — sem consumidor declarado.
- **Corrigir o overlay no payout** — o relatório apenas expõe que `finishTournament` ignora `guaranteedPrize` (`tournament.service.ts:1069-1072`). Corrigir é mudança de regra financeira (reembolso/ajuste de torneios já pagos) — tarefa separada, com decisão de produto própria.

## Três coisas que o escopo original não previa e viraram tarefa

1. **`startedAt` não existe** (`RT-DB-01`/`RT-BE-01`): "duração total do torneio" era incalculável.
2. **"Rebuys/add-ons" não existem no domínio** (`RT-SH-01`): o que existe é reentrada. A estatística correta é `reentries = totalEntries − uniquePlayers`.
3. **A maioria das colocações não está gravada** (`RT-BE-02`): só as faixas premiadas exigem `finalPosition`. Daí a posição derivada por ordem de eliminação, com `positionSource` explícito.
