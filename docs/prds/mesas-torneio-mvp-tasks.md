# Mesas de Torneio (MVP) — Decomposição em tarefas

Gerado pelo agente `arquiteto` a partir de [`mesas-torneio-mvp.md`](./mesas-torneio-mvp.md), com exploração real do repositório (schema Prisma, services de `table`/`tournament`, `packages/shared`). Convenção de ID: `MT-<CAMADA>-<NN>`.

## Status: IMPLEMENTADO (23/08/2026)

Todas as tarefas de `MT-000` a `MT-QA-04` foram implementadas e verificadas, mais uma tarefa que não estava no board original (`MT-FE-06`, abaixo). O restante deste documento é o plano original — mantido como registro de decisão, agora com este cabeçalho marcando o resultado. As seções individuais de cada tarefa **não** foram editadas uma a uma com "✅" — este resumo é a fonte de verdade sobre o que foi de fato construído; onde a implementação real divergiu do plano, isso está listado abaixo.

**Verificação final (rodada no monorepo inteiro, não por tarefa isolada):**

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` (backend, frontend, shared) | limpo |
| `eslint` (backend, frontend, shared) | limpo |
| Testes unitários — backend | 392/392 (33 suites) |
| Testes unitários — frontend | 273/273 (43 suites) |
| Testes unitários — shared | 15/15 |
| e2e contra Postgres real (`test/*.e2e-spec.ts`) | 21/21, incluindo `MT-QA-01` (concorrência) rodado 10× seguidas sem flake |
| Integração de schema (`schema-invariants.int-spec.ts`) | 25/25 (18 cenários novos) |
| Cobertura de `seating.ts` (`MT-BE-02`) | 100% statements/branches/functions/lines, + teste de propriedade (500 sequências aleatórias) |

**Arquivos principais criados/alterados, por área:**

- **Schema** (`apps/backend/prisma/schema/`): `base.prisma` (3 enums novos), `tournament.prisma` (`BlindStructure`, `BlindLevel`, `TournamentBlindLevel`, `TournamentTable`, `TournamentSeat`, campos de relógio/reentry/`tableCapacity` em `Tournament`), `identity.prisma` (back-relations), migrations `20260822120000_tournament_tables_and_blinds` e `20260822140000_tournament_table_capacity`.
- **Shared** (`packages/shared/src/`): 3 enums, 6 DTOs (`blind-level`, `blind-structure`, `tournament-clock`, `tournament-seat`, `tournament-table`, `tournament-table-map`, incl. variantes públicas sem `userId`), extensão de `tournament-entry.dto.ts`.
- **Backend** (`apps/backend/src/tournament/`): `seating.ts` (algoritmo puro), `blind-structure.{service,controller,mappers}.ts`, `tournament-clock.service.ts`, `tournament-display.controller.ts` (rota pública), `tournament.service.ts` reescrito (`registerEntry`/`eliminateEntry`/`redrawTables`/reentry, com lock pessimista serializando tudo por torneio), `tournament.controller.ts` (rotas de clock/redraw), `tournament.mappers.ts`.
- **Testes backend**: `seating.spec.ts`, `blind-structure.*.spec.ts`, `tournament-clock.service.spec.ts`, `tournament-display.controller.spec.ts`, `tournament.service.spec.ts` estendido, `test/tournament-tables.e2e-spec.ts` (novo, concorrência), `test/tournament-helpers.ts` (fixtures extraídas), `test/schema-invariants.int-spec.ts` estendido.
- **Frontend** (`apps/frontend/src/`): `lib/api/tournament.ts` estendido + `lib/api/blind-structure.ts` novo, `hooks/use-tournament-clock.ts` (compartilhado entre staff e TV), `components/tournament/{table-map,clock-control,blind-display,blind-structure-manager}.tsx`, `app/tournaments/[id]/{tables,clock}/page.tsx`, `app/display/tournaments/[id]/page.tsx`, `app/blind-structures/page.tsx`, `lib/format.ts` (`formatCountdown`), mais os specs correspondentes e a extensão de `create-tournament-form.tsx`/`tournament-detail.tsx`.

### Bugs reais de produção encontrados e corrigidos durante a implementação (não previstos no plano)

Todos achados pelos próprios testes de concorrência/e2e escritos como parte das tarefas — não bugs deste plano, bugs que só existiam sob carga real e que o plano não tinha como prever:

1. **Thundering herd no `registerEntry`** (`MT-QA-01`): sob 20 inscrições simultâneas, só 4 passavam e 16 voltavam 409 "muita concorrência" — o critério de aceite do PRD (20 concorrentes → 3 mesas) era inalcançável com o desenho original de lock otimista + retry. Corrigido serializando `registerEntry` sob o mesmo lock pessimista do torneio (`SELECT ... FOR UPDATE`) que já protegia `eliminateEntry`.
2. **Replay de idempotência furando sob duplo-clique simultâneo**: a checagem de replay fora do lock deixava as duas cópias de uma requisição passarem antes do commit. Corrigido: replay é checado dentro da transação, sob o lock.
3. **Ciclo de deadlock latente entre `registerEntry` e `finishTournament`**: ordens de lock invertidas (torneio→wallet vs. wallet→torneio) entre os dois métodos. Corrigido uniformizando a ordem.
4. **PATCH de nível de blind com relógio `RUNNING` dava 500** (`MT-BE-07`, achado pelo `MT-QA-03`): a escrita gravava a linha inteira do torneio (incluindo relações) em vez de só as 4 colunas do relógio. Corrigido nomeando as colunas explicitamente no `data` do update.

### `MT-FE-06` (nova, não estava no board original) — amarrar navegação e formulário

O board original (seção "Grafo de dependências") parava em `MT-FE-05` e não previa: uma tela de admin para criar `BlindStructure` (só existia a API), campos no formulário de criação de torneio para `tableCapacity`/`blindStructureId`/reentry, e links de navegação para as páginas de relógio/TV a partir do detalhe do torneio. Sem isso as páginas de `MT-FE-02..04` ficavam **órfãs** — existiam mas eram inalcançáveis pela UI, e um torneio criado pela UI nascia sem nenhum nível de blind. Fechado com: `app/blind-structures/page.tsx` + `components/tournament/blind-structure-manager.tsx` (lista + criação, sem edição/exclusão pela UI ainda — a API já suporta), extensão de `create-tournament-form.tsx`, e três links novos (`Ver mesas` / `Controlar relógio` / `Tela de TV`) em `tournament-detail.tsx`.

### Nota operacional — banco de desenvolvimento

O banco de **dev** local (porta 5432) tinha sido provisionado via `prisma db push` (sem histórico de migration), então as duas migrations novas não se aplicavam por `migrate deploy` direto (P3005 — schema não vazio, sem baseline). Resolvido sem perda de dado com:
```bash
pnpm --filter @poker-system/backend exec prisma migrate resolve --applied 20260821013117_init_schema_integration
pnpm --filter @poker-system/backend exec prisma migrate deploy
```
O banco de **teste** (porta 5433) já nasce migrado do zero a cada suíte e não precisou disso. Se alguém clonar o repo do zero, `docker compose up -d postgres && pnpm --filter @poker-system/backend exec prisma migrate deploy` já resolve sem o passo de baseline (só é necessário em bancos pré-existentes criados antes desta feature).

### Pendências conhecidas (deixadas de propósito, não esquecidas)

- Edição/exclusão de `BlindStructure` pela UI (API já suporta as duas).
- Gate de `UserRole.ADMIN` client-side na tela de controle do relógio (o backend já recusa não-admin com 403; falta só o early-return na UI).
- Item próprio na `BottomNav` para presets de blind (hoje só via link contextual no form de criação).
- `MT-QA-04`: sem Playwright/Cypress no frontend — decisão deliberada, coberta por RTL + fake timers + prova de que o servidor é fonte única do relógio.
- Estruturas de itens completas (rebuy/addon como produto configurável), financeiro do torneio dedicado, ranking, chipcount, Sangeur, app gerencial nativo — tudo fora de escopo deste MVP, mapeado nas Fases 2-4 do PRD.

---

## Estado atual confirmado no repo (âncoras reais)

| Afirmação do PRD | Verificado | Âncora |
|---|---|---|
| `TournamentEntry` tem `@@unique([tournamentId, userId])` | Confirmado | `apps/backend/prisma/schema/tournament.prisma:214` e `migrations/20260821013117_init_schema_integration/migration.sql:302` (`tournament_entries_tournament_id_user_id_key`) |
| Não existe modelo de blind/relógio/mesa de torneio | Confirmado | nenhum match em `prisma/schema/` |
| `TableType.TOURNAMENT` existe e não é usado | Confirmado | `base.prisma:96-99`; `TableService.createTable` só repassa `dto.type`, nada no `TournamentService` cria `Table` |
| Padrão de índice único parcial em SQL puro | Confirmado | `migration.sql:445` e `:449` (`table_sessions_active_seat_unique`, `table_sessions_active_user_unique`) |
| Lock otimista com loop de retry | Confirmado, duplicado | classe local `OptimisticLockError` + `for (attempt < 3)` + `updateMany({ where: { id, version } })` em `table.service.ts:416` e `tournament.service.ts:407` |
| Idempotência via `Idempotency-Key` | Confirmado, mas **não há tabela de idempotência**: a chave vive em `WalletTransaction.idempotencyKey` com prefixo (`tournament-buyin:${key}`) e o replay é resolvido por `existingTxn.tournamentEntryId` (`tournament.service.ts:150-161`) |

## Decisões tomadas (22/08/2026)

**`MT-000` = Rota (a): reentry/rebuy ENTRA no escopo do MVP.** Sem reentry, "quebra de mesas" é uma feature que só aparece em torneios freezeout — minoria no uso real de clube — e o épico inteiro perde a maior parte do seu valor de demonstração. O custo (índice parcial + DTO extra) é pequeno frente ao ganho. `MT-DB-06` e `MT-BE-09` estão **ATIVAS**, não canceladas.

**`MT-001` = política de rebalanceamento definida:**
1. Origem: sempre a mesa mais cheia; empate → maior `tableNumber` (determinístico, sem estado extra).
2. Destino: primeiro assento livre por número (não a posição "correta" em relação ao botão). `// ponytail: primeiro-livre, não a posição relativa ao botão — se o clube reclamar de assento ruim pós-move, revisar.`
3. Sem limite de trocas por jogador no MVP. `// ponytail: sem anti-igreja (mover quem acabou de mover), adicionar se virar reclamação real.`
4. Quebra quando `jogadoresVivos <= (mesasAbertas - 1) * capacidade`; quebra a mesa de maior `tableNumber` entre as menos ocupadas (mesmo desempate do item 1, por consistência).
5. Rebalanceamento roda a cada eliminação, mas só produz `Move[]` quando a diferença de ocupação excede 1 — na maioria das eliminações é no-op.

**`MT-003` (novo) — fluxo de entrega de fichas e validação de saldo, dentro de `registerEntry` (e `MT-BE-09` para reentry):** o padrão já existente no `TournamentService.registerEntry` está correto e é reafirmado, não substituído — a mudança é só inserir o assento na mesma transação:

1. Uma única `prisma.$transaction`, wallet com **lock pessimista** (`SELECT ... FOR UPDATE`, mesmo padrão de `base.prisma:33-41`).
2. Dentro da transação: debitar `buyIn + fee` da wallet primeiro. Saldo insuficiente ⇒ a query de débito falha (constraint/check existente) ⇒ toda a transação reverte. **Nenhuma ficha e nenhum assento são criados se o débito falhar** — não existe estado intermediário "ficha entregue, dinheiro não confirmado".
3. Só então: criar `TournamentEntry` com `chipStack` e, na mesma transação, calcular e gravar o `TournamentSeat` (via `MT-BE-02`/`planInitialSeat`).
4. `WalletTransaction` (ledger) e `Idempotency-Key` continuam sendo a fonte de verdade do replay — reenviar a mesma chave não debita duas vezes nem gera assento duplicado; o early-return de replay (armadilha 2 de `MT-BE-04`) precisa incluir o assento no payload devolvido.
5. Reentry (`MT-BE-09`) segue exatamente o mesmo fluxo — débito, entry nova, assento novo — a única diferença é a validação de `maxReentries`/`reentryUntilLevel` antes de abrir a transação.

Não há "reduzir o dinheiro antes de entregar a ficha" como duas etapas distintas: é uma única operação atômica onde o débito é a primeira instrução dentro da transação e a ficha só existe se ela — e a transação inteira — for confirmada pelo Postgres. Isso já é o padrão do ledger financeiro do projeto (linha 3 do documento); a novidade do MVP é só garantir que o assento entre no mesmo envelope transacional.

---

Coisas que o PRD **não** menciona e que viraram tarefa/decisão explícita:

1. **`eliminateEntry` hoje não é transacional, não é idempotente e não incrementa `version`** (`tournament.service.ts:250-283`: três statements soltos). Não dá para pendurar rebalanceamento nele sem reescrever a base.
2. **O modelo de relógio da seção 6 do PRD não fecha no `PAUSED`**: com só `clockStatus`/`currentLevelNumber`/`levelEndsAt`, pausar perde o tempo restante. Falta uma coluna de resto (`clockRemainingMs`).
3. **Não existe `@Public()` no projeto** — o guard é `@UseGuards(JwtAuthGuard)` por controller (`tournament.controller.ts:30`). O endpoint "público" da TV precisa de controller próprio, e `@Get(':id')` no controller atual é um catch-all que causa ambiguidade de rota se o novo endpoint ficar sob o mesmo prefixo.
4. **Não há Playwright/Cypress no frontend** — só Jest + Testing Library. "E2E" no repo hoje significa `apps/backend/test/*.e2e-spec.ts` (supertest contra Nest + Postgres real).

---

# FASE 0 — Decisões bloqueadoras (nenhuma linha de código antes disto)

### `MT-000` · DECISÃO: reentry/rebuy — rota (a) ou rota (b) — **BLOQUEIA TUDO**
**Tipo:** decisão de produto + arquitetura. Sem código.
**Problema:** `tournament.prisma:214` e `migration.sql:302` impedem que o mesmo `userId` tenha duas `TournamentEntry` no mesmo torneio. A escolha muda o schema, a chave de idempotência do buy-in, o algoritmo de assentos e o critério de aceite dos testes de balanceamento.

**Rota (a) — reentry no escopo do MVP**
- Remover `@@unique([tournamentId, userId])`; criar índice único **parcial** `tournament_entries_active_user_unique ON tournament_entries (tournament_id, user_id) WHERE status IN ('REGISTERED','PLAYING')` — mesmo padrão de `table_sessions_active_user_unique`.
- `CreateTournamentDto` ganha `allowReentry: boolean`, `maxReentries?: number`, `reentryUntilLevel?: number`.
- `registerEntry` deixa de tratar P2002 como "já inscrito" incondicionalmente (`tournament.service.ts:237-239`) e passa a validar limite de reentradas + nível-limite.
- **Impacto nas tarefas seguintes:** `MT-BE-04` precisa lidar com "jogador voltando ao torneio já em andamento" (sentar em mesa existente, não em distribuição inicial); `MT-BE-05` precisa que a eliminação **libere** o assento sem impedir uma futura re-alocação; `MT-QA-01` ganha um cenário "eliminação + reentry concorrentes".
- Custo: +1 tarefa DB (`MT-DB-06`), +1 tarefa BE (`MT-BE-09`), +2 cenários de teste. Estimativa: ~15-20% no épico.

**Rota (b) — freezeout only neste MVP**
- Schema intocado. `MT-DB-06` e `MT-BE-09` saem do backlog.
- `TournamentSeat` ainda precisa do índice parcial por `active` (a mesma inscrição muda de assento várias vezes ao longo do torneio) — isso **não** depende da decisão.
- **Impacto:** o `active`/`reason` de `TournamentSeat` continua idêntico; a diferença é só que `entry.status = ELIMINATED` vira estado terminal e o algoritmo de assentos nunca reinsere ninguém.
- Dívida registrada: quando a Fase 2 (estrutura de itens) chegar, migrar a constraint em produção exige backfill + janela — mais caro que fazer agora.

**Critério de aceite:** decisão escrita (a) ou (b) neste documento, e as tarefas `MT-DB-06`/`MT-BE-09` marcadas como ATIVAS ou CANCELADAS antes de qualquer commit.

---

### `MT-001` · DECISÃO: política de rebalanceamento (PRD §10 em aberto)
**Tipo:** decisão de domínio. Sem código. **Bloqueia `MT-BE-02` (algoritmo).**
Sem isso o algoritmo não é testável — "correto" fica indefinido. Precisa de resposta binária para cada item:

1. Origem do jogador movido: sempre da mesa mais cheia? Em empate, qual critério de desempate (menor número de mesa? assento mais recente?) — precisa ser **determinístico** para o teste ser reprodutível.
2. Assento de destino: primeiro assento livre por número, ou o assento "correto" em relação ao botão (regra de torneio real: entra no big blind)? **Recomendação: primeiro-livre no MVP**, com nota de dívida.
3. Existe limite de movimentações por jogador? ("não mover quem acabou de ser movido")
4. Gatilho de quebra: quebra a mesa quando `jogadoresVivos <= (mesasAbertas - 1) * capacidade`? Qual mesa quebra — a de maior número, ou a com menos jogadores?
5. Rebalanceamento roda a cada eliminação ou só quando a diferença passa de 1?

**Critério de aceite:** as 5 respostas viram comentário de docblock no arquivo do algoritmo (`MT-BE-02`) e a tabela-verdade de casos vira os casos do teste unitário.

---

### `MT-002` · DECISÃO (já com default): sincronização das telas = polling
**Tipo:** confirmação. O PRD já recomenda polling 1-2s; o repo já tem `ThrottlerModule` global e o comentário em `rate-limits.ts:6` cita explicitamente "polling de assentos" como tráfego normal esperado. **Default aceito, sem tarefa de infra.** Ação única: validar em `MT-BE-08` que o endpoint de leitura não estoura o limite global do throttler com N TVs (medir `RATE_LIMIT_LIMIT`).

---

# FASE 1 — Banco de Dados (Prisma + migration SQL)

Todos em `apps/backend/prisma/schema/`. Layout de pasta (`prismaSchemaFolder`), migrations em `prisma/schema/migrations/`.

### `MT-DB-01` · Enums novos em `base.prisma`
**Dep:** nenhuma.
Adicionar em `base.prisma` (fonte única de verdade dos enums do domínio, espelhada em `packages/shared`):
- `TournamentClockStatus { NOT_STARTED RUNNING PAUSED FINISHED }`
- `TournamentTableStatus { OPEN CLOSED }`
- `TournamentSeatReason { INITIAL BALANCE BREAK MANUAL_REDRAW }`

**Aceite:** os três enums existem em `base.prisma`, com docblock `///` explicando cada literal, no mesmo estilo dos existentes. `pnpm prisma validate` passa.
**Teste:** nenhum próprio — coberto por `MT-SH-01` (espelho) e `MT-QA-02`.

---

### `MT-DB-02` · Models `BlindStructure` + `BlindLevel` (preset reutilizável)
**Dep:** `MT-DB-01`.
Em `tournament.prisma` (mesmo bounded context; não criar arquivo novo — o preset é configuração de torneio, não um contexto próprio).

- `BlindStructure`: `id`, `name`, `createdById → User` (`onDelete: Restrict`, regra de `identity.prisma`), `createdAt`, `updatedAt`, `levels BlindLevel[]`, `tournaments Tournament[]`. `@@index([createdById])`. `@@map("blind_structures")`.
- `BlindLevel`: `id`, `blindStructureId` (`onDelete: Cascade` — é configuração, mesmo raciocínio de `TournamentPrize`), `levelNumber Int`, `smallBlind Int`, `bigBlind Int`, `ante Int @default(0)`, `durationSeconds Int`, `isBreak Boolean @default(false)`, `breakLabel String?`. `@@unique([blindStructureId, levelNumber])`. `@@map("blind_levels")`.

**Nota de tipo — importante:** blinds de torneio são **fichas**, não dinheiro → `Int`, não `Decimal(14,2)`. Contraste deliberado com `Table.smallBlind` (`table.prisma:67`), que é `Decimal` porque cash game é dinheiro real. Documentar no docblock, no mesmo espírito da nota de `chipStack` vs `prizeAmount` em `tournament.prisma:16-23`.

**Aceite:** models criados com docblocks; `Int` para blinds justificado em comentário; `pnpm prisma validate` passa.

---

### `MT-DB-03` · Relógio no `Tournament` + `TournamentBlindLevel` (cópia)
**Dep:** `MT-DB-01`, `MT-DB-02`.

No model `Tournament` (`tournament.prisma:44`), adicionar:
- `blindStructureId String? @map("blind_structure_id")` + relação (`onDelete: SetNull` — o preset é só a origem; apagar preset não pode quebrar torneio histórico).
- `clockStatus TournamentClockStatus @default(NOT_STARTED) @map("clock_status")`
- `currentLevelNumber Int? @map("current_level_number")`
- `levelEndsAt DateTime? @map("level_ends_at")`
- **`clockRemainingMs Int? @map("clock_remaining_ms")`** — gap do PRD §6. Semântica: `RUNNING` ⇒ `levelEndsAt` preenchido e `clockRemainingMs` nulo; `PAUSED` ⇒ `levelEndsAt` nulo e `clockRemainingMs` preenchido. Impede o bug "pausei e o relógio continuou correndo".
- `blindLevels TournamentBlindLevel[]`

Novo model `TournamentBlindLevel`: mesmos campos de `BlindLevel` + `tournamentId` (`onDelete: Cascade`), `@@unique([tournamentId, levelNumber])`, `@@map("tournament_blind_levels")`. Docblock deve dizer explicitamente **"cópia por valor: editar o preset depois NÃO altera este torneio"**.

**Aceite:** campos criados; a invariante `RUNNING⇔levelEndsAt` / `PAUSED⇔clockRemainingMs` documentada no docblock e virando `CHECK` em `MT-DB-05`.

---

### `MT-DB-04` · Models `TournamentTable` + `TournamentSeat`
**Dep:** `MT-DB-01`.

- `TournamentTable`: `id`, `tournamentId` (`onDelete: Restrict` — mesa é trilha operacional auditável, mesmo raciocínio de `TournamentEntry` em `tournament.prisma:153-158`), `tableNumber Int`, `capacity Int`, `status TournamentTableStatus @default(OPEN)`, `createdAt`, `updatedAt`, `seats TournamentSeat[]`. `@@unique([tournamentId, tableNumber])`, `@@index([tournamentId, status])`, `@@map("tournament_tables")`.
- `TournamentSeat` (**append-only, como o ledger**): `id`, `tournamentTableId`, `tournamentEntryId`, `seatNumber Int`, `active Boolean @default(true)`, `reason TournamentSeatReason`, `fromTableId String?` + `fromSeatNumber Int?` (origem, exigido pelo critério de aceite do PRD §5.2), `movedById String?` (`→ User`, nulo quando é automático — mesmo padrão de `StackMovement.createdById`, `table.prisma:208`), `createdAt`, `releasedAt DateTime?`.
  - `@@index([tournamentTableId, active])`, `@@index([tournamentEntryId, createdAt])`, `@@map("tournament_seats")`.
  - **Sem `@@unique`** — a unicidade é parcial e vai em SQL puro (`MT-DB-05`), exatamente pelo motivo documentado em `table.prisma:119-132`: um `@@unique` comum incluiria as linhas históricas e impediria um jogador de voltar a um assento que já ocupou.

**Aceite:** docblock explica por que cada realocação é INSERT e não UPDATE (trilha auditável, espelho do ledger); relação com `Table`/`TableSession` explicitamente **não** existe, com comentário dizendo por quê (vocabulário de cash game, stack em `Decimal`, wallet).

---

### `MT-DB-05` · Migration: índices únicos parciais + `CHECK` constraints (SQL puro)
**Dep:** `MT-DB-02`, `MT-DB-03`, `MT-DB-04` (e `MT-DB-06` se rota (a)).
Gerar com `pnpm --filter @poker-system/backend db:migrate --name tournament_tables_and_blinds` e **editar o SQL gerado à mão** para acrescentar, no fim (mesmo lugar e estilo de `migration.sql:428-449`):

```sql
CREATE UNIQUE INDEX "tournament_seats_active_seat_unique"
  ON "tournament_seats"("tournament_table_id", "seat_number") WHERE "active";
CREATE UNIQUE INDEX "tournament_seats_active_entry_unique"
  ON "tournament_seats"("tournament_entry_id") WHERE "active";
ALTER TABLE "tournament_tables" ADD CONSTRAINT "tournament_tables_capacity_valid"
  CHECK ("capacity" BETWEEN 2 AND 10);
ALTER TABLE "tournament_seats" ADD CONSTRAINT "tournament_seats_seat_number_positive"
  CHECK ("seat_number" >= 1);
ALTER TABLE "blind_levels" ADD CONSTRAINT "blind_levels_blinds_valid"
  CHECK ("small_blind" > 0 AND "big_blind" >= "small_blind" AND "ante" >= 0 AND "duration_seconds" > 0);
-- mesmo CHECK em tournament_blind_levels
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_clock_state_coherent" CHECK (
  ("clock_status" = 'RUNNING' AND "level_ends_at" IS NOT NULL AND "clock_remaining_ms" IS NULL)
  OR ("clock_status" = 'PAUSED' AND "clock_remaining_ms" IS NOT NULL)
  OR ("clock_status" IN ('NOT_STARTED','FINISHED'))
);
```

**Aceite:** `db:migrate:deploy` roda limpo em base zerada; `db:reset` + `db:migrate` reproduz. Cada bloco SQL tem comentário `--` explicando a regra, como no arquivo existente.
**Teste:** `MT-QA-02` (obrigatório — o SQL escrito à mão não tem outra rede de proteção; é a justificativa escrita em `schema-invariants.int-spec.ts:1-15`).

---

### `MT-DB-06` · Trocar unique de `TournamentEntry` por índice parcial — **ATIVA** (decisão `MT-000` = rota a)
**Dep:** `MT-000`.
- Remover `@@unique([tournamentId, userId])` de `tournament.prisma:214` e reescrever o docblock das linhas 211-213 (que hoje afirma o contrário).
- Na migration: `DROP INDEX "tournament_entries_tournament_id_user_id_key";` + `CREATE UNIQUE INDEX "tournament_entries_active_user_unique" ON "tournament_entries"("tournament_id","user_id") WHERE "status" IN ('REGISTERED','PLAYING');`
- Campos de configuração em `Tournament`: `allowReentry Boolean @default(false)`, `maxReentries Int?`, `reentryUntilLevel Int?`.

**Aceite:** o mesmo user consegue ter 2 entries no mesmo torneio desde que no máximo uma esteja em `REGISTERED|PLAYING`; a segunda entry ativa simultânea é rejeitada **pelo banco**.
**Teste:** cenário novo em `MT-QA-02`.

---

# FASE 1 — Contratos compartilhados

### `MT-SH-01` · Enums e DTOs em `packages/shared`
**Dep:** `MT-DB-01`..`MT-DB-04`.
Arquivos novos em `packages/shared/src/`, todos exportados em `index.ts` (abrir seção `--- MT / Mesas de Torneio ---`):

- `enums/tournament-clock-status.enum.ts`, `enums/tournament-table-status.enum.ts`, `enums/tournament-seat-reason.enum.ts` — espelho **literal e na mesma ordem** do Prisma (`base.prisma:83-86`).
- `interfaces/blind-level.dto.ts` — `{ levelNumber, smallBlind, bigBlind, ante, durationSeconds, isBreak, breakLabel }`. Todos `number` (fichas, não `MoneyString`).
- `interfaces/blind-structure.dto.ts` — `{ id, name, levels: BlindLevelDto[] }`.
- `interfaces/tournament-clock.dto.ts` — `{ clockStatus, currentLevel: BlindLevelDto | null, nextLevel: BlindLevelDto | null, levelEndsAt: string | null, remainingMs: number, serverTime: string }`.
  **`serverTime` é obrigatório**: sem ele o cliente calcula a contagem com o relógio local do dispositivo, e uma TV com clock errado mostra tempo errado. O cliente calcula `offset = serverTime - Date.now()` uma vez e aplica.
- `interfaces/tournament-seat.dto.ts` — `{ entryId, userId, userName, seatNumber, chipStack }`.
- `interfaces/tournament-table.dto.ts` — `{ id, tableNumber, capacity, status, seats: TournamentSeatDto[] }`.
- `interfaces/tournament-table-map.dto.ts` — `{ tournamentId, tables: TournamentTableDto[], playersRemaining: number, averageStack: number }`.
- Estender `TournamentEntryDto` (`interfaces/tournament-entry.dto.ts`) com `tableNumber: number | null` e `seatNumber: number | null` — é o "ticket" do PRD §5.1. Campos nullable, então não quebra consumidor existente.

**Aceite:** `pnpm --filter @poker-system/shared build` passa; `index.spec.ts` (que já valida os exports) atualizado.
**Teste:** unitário em `index.spec.ts` — cada enum novo tem os mesmos literais do Prisma. Este teste falha se `MT-DB-01` e `MT-SH-01` divergirem.

---

# FASE 1 — Backend (NestJS)

Módulo: estender `apps/backend/src/tournament/`. **Não criar módulo novo** — mesmo bounded context, mesmo `TournamentModule`.

### `MT-BE-01` · `blind-structure` CRUD (ADMIN)
**Dep:** `MT-DB-05`, `MT-SH-01`.
- `dto/create-blind-structure.dto.ts`: `name`, `levels: BlindLevelInputDto[]` (padrão de `tournament-prize-input.dto.ts` + `@ValidateNested`/`@Type`). Validações de conjunto no service: `levelNumber` sequencial começando em 1, sem buracos nem repetição; `bigBlind >= smallBlind`; nível `isBreak` exige `breakLabel`.
- `blind-structure.service.ts`: `create`, `list`, `get`, `update` (substitui os níveis inteiros numa transação — evita diff parcial), `delete` (bloquear se algum `Tournament.blindStructureId` aponta para ele → `ConflictException`).
- Controller novo `blind-structure.controller.ts`, prefixo `blind-structures`, para não cair no catch-all `@Get(':id')` de `tournaments`. `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)` nas mutações.
- Mapper em `blind-structure.mappers.ts` seguindo `tournament.mappers.ts`.

**Aceite:** admin cria preset com N níveis; não-admin recebe 403; níveis fora de sequência → 400; deletar preset em uso → 409.
**Testes:** unitário `blind-structure.service.spec.ts` (validações de conjunto, prisma mockado) + `blind-structure.controller.spec.ts` (guards/roles) + cenário no `tournament.e2e-spec.ts`.

---

### `MT-BE-02` · Algoritmo de assentos como **função pura** (`seating.ts`)
**Dep:** `MT-001` (política decidida). **Não depende do banco** — e é essa a graça.
Arquivo: `src/tournament/seating.ts`. Zero import de Prisma, zero I/O. Recebe e devolve estruturas simples:

- `planInitialSeat(tables: {tableNumber, capacity, occupiedSeats: number[]}[], defaultCapacity): { tableNumber, seatNumber, openNewTable: boolean }`
- `planRebalance(tables, policy): Move[]` onde `Move = { entryIndexOrId, fromTable, fromSeat, toTable, toSeat, reason }`
- `planRedraw(entryIds, capacity, seed?): Seat[]` — **`seed` opcional para o teste ser determinístico**; sem seed usa `crypto.randomInt`.

**Por que separado:** é a peça de maior risco do PRD (§10) e a única testável exaustivamente sem Postgres. Toda a tabela-verdade de `MT-001` vira teste unitário de milissegundos; o teste e2e (`MT-QA-01`) fica responsável só pela **concorrência e transacionalidade**, não pela correção da regra.

**Aceite:** invariante `max(ocupação) - min(ocupação) <= 1` verificada por **teste de propriedade** (loop de 500 sequências aleatórias de inscrição/eliminação, assert da invariante a cada passo) — não só exemplos escolhidos a dedo. Função nunca retorna dois `Move` para o mesmo assento de destino.
**Testes:** `seating.spec.ts` — os 5 itens da política de `MT-001` + o teste de propriedade. **Cobertura exigida: 100% de branches deste arquivo** (o global é 70%, `package.json:106-113`).

---

### `MT-BE-03` · `createTournament` aceita estrutura de blind e copia os níveis
**Dep:** `MT-BE-01`, `MT-DB-03`.
Em `tournament.service.ts:42-84`:
- `CreateTournamentDto` ganha `blindStructureId?: string` e `tableCapacity: number` (`@Min(2) @Max(10)`, default 9 — casa com o `CHECK` de `MT-DB-05`).
- Dentro do `prisma.tournament.create` (via `blindLevels: { create: [...] }`), copiar os `BlindLevel` do preset para `TournamentBlindLevel`. Falhar com 404 se o preset não existir.
- `clockStatus` nasce `NOT_STARTED`, `currentLevelNumber` nulo.
- Se rota (a): validar `maxReentries`/`reentryUntilLevel` coerentes com `allowReentry`.

**Aceite:** editar o preset depois **não** altera o torneio (teste explícito); torneio sem `blindStructureId` continua funcionando (retrocompatível).
**Testes:** unitário no `tournament.service.spec.ts` já existente + e2e "cria preset → cria torneio → edita preset → GET torneio mostra níveis antigos".

---

### `MT-BE-04` · Distribuição inicial de assento acoplada a `registerEntry`
**Dep:** `MT-BE-02`, `MT-BE-03`. **A tarefa mais delicada do épico.**
Em `tournament.service.ts:145-247`. Quatro armadilhas nominais:

1. **O assento tem que nascer dentro do `$transaction` existente** (linha 194), junto com a `TournamentEntry` e o lançamento de wallet. Nunca em transação separada — senão existe janela com entry sem assento, violando "nunca deixa um jogador no ar".
2. **O early-return de replay (linhas 152-161) precisa carregar o assento ativo.** Hoje devolve `toTournamentEntryDto(existingEntry)` sem `include` de assento; com os campos novos do DTO, o replay devolveria `tableNumber: null` e o caixa reimprimiria um ticket vazio — o critério de aceite de idempotência do PRD §5.1 falhando silenciosamente.
3. **O plano de assento tem que ser recalculado a cada tentativa do loop de retry** (linha 167), depois da leitura do torneio — não antes do loop. Um `continue` por `OptimisticLockError` com plano stale sentaria o jogador num assento já tomado.
4. **Distinguir as colisões P2002.** O `catch` da linha 237 mapeia qualquer P2002 para "Você já está inscrito neste torneio." Com os índices novos, uma colisão em `tournament_seats_active_seat_unique` (duas inscrições simultâneas mirando o mesmo assento) cairia nessa mensagem errada. Inspecionar `error.meta.target`: colisão de assento ⇒ `continue` (retry, o plano se refaz), colisão de entry ⇒ 409 como hoje.

Abertura de mesa: quando `planInitialSeat` retorna `openNewTable`, criar a `TournamentTable` na mesma transação; a colisão em `@@unique([tournamentId, tableNumber])` também é retry, não erro.

**Aceite:** os três critérios do PRD §5.1, verbatim. Mais: 20 inscrições concorrentes numa mesa de capacidade 9 produzem exatamente 3 mesas com ocupação 7/7/6 (ou a distribuição que `MT-001` definir), zero assentos duplicados, zero entries sem assento.
**Testes:** unitário (service com prisma mockado, cobre os 4 pontos acima incluindo o replay) + **e2e obrigatório** com `Promise.all` de N inscrições — cenário do `MT-QA-01`.

---

### `MT-BE-05` · Liberação de assento + balanceamento/quebra em `eliminateEntry`
**Dep:** `MT-BE-02`, `MT-BE-04`. **Requer refatorar o método antes de estender.**
Em `tournament.service.ts:250-283`. Hoje são três statements soltos, sem transação e sem lock. Passos:

1. **Envolver tudo em `prisma.$transaction`.**
2. **Serializar por torneio.** Duas eliminações concorrentes leem o mesmo mapa de mesas e produzem planos de movimentação incompatíveis; o lock otimista de `version` daria `count = 0` e retry, mas o retry teria que refazer N moves de linhas diferentes — caro e propenso a laço. **Recomendação: lock pessimista na linha do torneio** — `SELECT id FROM tournaments WHERE id = $1 FOR UPDATE` via `$queryRaw` no início da transação, como a wallet faz (`base.prisma:33-41`). Justificativa: eliminação é evento de baixa frequência, e a consequência de errar é um jogador em dois assentos ou em nenhum — mesmo trade-off que motivou o pessimista na wallet. Marcar com `// ponytail: lock por torneio; se um dia houver torneios com milhares de eliminações/min, particionar por mesa.`
3. Marcar o `TournamentSeat` ativo do eliminado: `active = false`, `releasedAt = now()`. **UPDATE de desativação, nunca DELETE** (append-only).
4. Rodar `planRebalance` com o estado lido **dentro** da transação; aplicar cada `Move` como: desativa a linha atual + `INSERT` de nova linha `active` com `reason`, `fromTableId`, `fromSeatNumber`, `movedById = null`.
5. Quebra de mesa: quando o plano esvazia uma mesa, `TournamentTable.status = CLOSED` na mesma transação.
6. Manter o efeito `REGISTERING → RUNNING` (linhas 266-269) **dentro** da transação.
7. Idempotência: hoje o método reexecutado dá 400 "Inscrição já foi eliminada" (linha 262) — aceitável, já é o comportamento; **não** adicionar `Idempotency-Key` aqui, não há dinheiro envolvido. Documentar a escolha.

**Aceite:** todos os critérios do PRD §5.2. Adicionalmente: após qualquer eliminação, `SELECT count(*) FROM tournament_seats WHERE active` = número de entries vivas (invariante "ninguém no ar"), e nenhum `active` aponta para mesa `CLOSED`.
**Testes:** unitário (mock, cobre a ordem dos passos e o rollback) + **`MT-QA-01`** (concorrência real).

---

### `MT-BE-06` · Endpoint de redraw manual (ADMIN)
**Dep:** `MT-BE-05`.
`POST /tournaments/:id/redraw` — `@Roles(UserRole.ADMIN)`. Service `redrawTables(adminId, tournamentId)`:
- Mesmo lock pessimista de `MT-BE-05`.
- `planRedraw` sobre todas as entries vivas; desativa **todos** os seats ativos e insere os novos com `reason = MANUAL_REDRAW` e `movedById = adminId` (aqui o ator é obrigatório — é o "por quem, se manual" do PRD).
- Abre/fecha mesas conforme o novo número necessário.
- **Decisão embutida: permitir redraw com o relógio `RUNNING`** (o diretor decide), retornando o mapa novo para o staff conferir. Documentar.

**Aceite:** após o redraw, a invariante de diferença ≤ 1 vale; todo jogador vivo tem exatamente um seat ativo; o histórico anterior continua consultável.
**Testes:** unitário + e2e (redraw com 23 jogadores em 3 mesas de 9).

---

### `MT-BE-07` · Controle do relógio (ADMIN)
**Dep:** `MT-DB-03`, `MT-BE-03`.
`tournament-clock.service.ts` + rotas no `TournamentController`, todas `@Roles(UserRole.ADMIN)`:

| Rota | Efeito |
|---|---|
| `POST /tournaments/:id/clock/start` | `NOT_STARTED → RUNNING`; `currentLevelNumber = 1`; `levelEndsAt = now + duration`; `clockRemainingMs = null` |
| `POST /tournaments/:id/clock/pause` | `RUNNING → PAUSED`; `clockRemainingMs = levelEndsAt - now` (clamp em 0); `levelEndsAt = null` |
| `POST /tournaments/:id/clock/resume` | `PAUSED → RUNNING`; `levelEndsAt = now + clockRemainingMs`; `clockRemainingMs = null` |
| `POST /tournaments/:id/clock/next` | `currentLevelNumber + 1`; recalcula `levelEndsAt` pela duração do novo nível; último nível ⇒ `FINISHED` |
| `POST /tournaments/:id/clock/previous` | `currentLevelNumber - 1`; idem; recusa abaixo de 1 |
| `PATCH /tournaments/:id/blind-levels/:levelNumber` | Edita `smallBlind`/`bigBlind`/`ante`/`durationSeconds` do `TournamentBlindLevel` |

**Regra crítica do `PATCH` (critério de aceite do PRD §5.3):** se o nível editado é o corrente e o relógio está `RUNNING`, aplicar o **delta** — `levelEndsAt += (novaDuração - duraçãoAntiga)` — não recalcular a partir do zero (isso ressuscitaria tempo já decorrido). Se `PAUSED`, aplicar o delta em `clockRemainingMs` (clamp em 0).

Todas as mutações sob lock otimista de `Tournament.version` com o loop de retry já padronizado, e cada uma valida a transição de estado (máquina de estados na aplicação, `tournament.prisma:39-43`).

**Aceite:** transições inválidas → 400; todo `POST` retorna o `TournamentClockDto` já atualizado.
**Testes:** unitário exaustivo da máquina de estados com **tempo mockado** (`jest.useFakeTimers`) — cada transição, incluindo pause→resume preservando o restante e o delta do `PATCH`.

---

### `MT-BE-08` · Leitura pública: relógio + mapa de mesas (polling)
**Dep:** `MT-BE-05`, `MT-BE-07`, `MT-SH-01`.
**Controller novo e sem `JwtAuthGuard`**: `tournament-display.controller.ts`, prefixo `@Controller('display/tournaments')` — distinto de `tournaments/` porque `@Get(':id')` em `TournamentController` é catch-all.

- `GET /display/tournaments/:id/clock` → `TournamentClockDto`, **com `serverTime`**.
- `GET /display/tournaments/:id/tables` → `TournamentTableMapDto`.

Pontos obrigatórios:
- **Sem dado sensível.** Nome do jogador, mesa, assento e chipStack são OK; `userId`, e-mail, documento, valores de wallet **não**. Revisar o mapper campo a campo — é fronteira de confiança.
- `Cache-Control: no-store`.
- Uma query só por endpoint (`include` aninhado), não N+1 por mesa.
- Validar contra `ThrottlerModule` global com o cenário "8 TVs × polling 1s por 60s"; se estourar, `@Throttle()` próprio mais generoso nestas duas rotas, com comentário.

**Aceite:** `curl` sem `Authorization` retorna 200; dois clientes chamando ao mesmo tempo recebem `levelEndsAt` idêntico; `remainingMs` derivado do servidor, nunca do cliente.
**Testes:** unitário do mapper (assert de que campos sensíveis **não** estão no payload — teste negativo explícito) + e2e sem token.

---

### `MT-BE-09` · Reentry no `registerEntry` — **ATIVA** (decisão `MT-000` = rota a)
**Dep:** `MT-DB-06`, `MT-BE-04`.
- Validar `allowReentry`, contagem de entries anteriores vs `maxReentries`, e `currentLevelNumber <= reentryUntilLevel`.
- A chave de idempotência do buy-in (`tournament-buyin:${key}`) **continua funcionando** — é por request, não por (torneio,user). Confirmar em teste.
- O jogador que reentra em torneio já `RUNNING` não passa por "distribuição inicial": entra pela mesa com mais vagas via `planInitialSeat` sobre o estado corrente. Verificar que isso não viola a invariante ≤ 1.
- `prizePool` incrementa também na reentrada.

**Aceite:** eliminado reentra e recebe mesa/assento novos; a entry antiga continua `ELIMINATED` com seu histórico de assentos intacto; ultrapassar `maxReentries` → 400.
**Testes:** unitário + e2e "inscreve → elimina → reentra → confirma 2 entries e 1 seat ativo".

---

# FASE 1 — Frontend (Next.js)

Todos em `apps/frontend/src/`. Padrão vigente: TanStack Query + `httpClient` + componentes de `components/ui`.

### `MT-FE-01` · Cliente de API
**Dep:** `MT-BE-06`, `MT-BE-07`, `MT-BE-08`, `MT-SH-01`.
- Estender `lib/api/tournament.ts` (padrão `TOURNAMENT_PATHS` + funções + objeto `tournamentApi`) com: `getClock`, `getTableMap`, `startClock`, `pauseClock`, `resumeClock`, `nextLevel`, `previousLevel`, `updateBlindLevel`, `redraw`.
- Novo `lib/api/blind-structure.ts` com o CRUD de presets.
- Tipos de request em `lib/api/types.ts`.
- Rotas de display usam `/display/tournaments/...` — verificar se `httpClient` anexa `Authorization` incondicionalmente; se anexar, tudo bem (backend ignora), mas a tela de TV deve funcionar **sem sessão**.

**Aceite:** paths batem 1:1 com os controllers.
**Testes:** `tournament.spec.ts` / `blind-structure.spec.ts` — `httpClient` mockado.

---

### `MT-FE-02` · Tela de mesas do torneio (staff)
**Dep:** `MT-FE-01`.
- `components/tournament/table-map.tsx` + rota `app/tournaments/[id]/tables/page.tsx`.
- Grid de mesas; cada mesa mostra número, ocupação `n/capacidade`, e os assentos com nome + chipStack. Reusar `components/table/seat-grid.tsx` se o shape permitir — checar antes de escrever componente novo.
- `useQuery` com `refetchInterval: 3000`.
- Ações ADMIN: "Redraw manual" com `ConfirmDialog` (já existe em `components/ui`) e "Eliminar" reaproveitando `tournamentApi.eliminateEntry`, invalidando as queries de mesas e do torneio.
- Gate por `useSession().user?.role === UserRole.ADMIN`, como `tournament-detail.tsx:125`.

**Aceite:** eliminar um jogador atualiza o mapa em ≤ 1 ciclo de refetch; não-admin não vê botões de ação.
**Testes:** RTL (`table-map.spec.tsx`).

---

### `MT-FE-03` · Tela de controle do relógio (staff)
**Dep:** `MT-FE-01`.
- `components/tournament/clock-control.tsx` + rota `app/tournaments/[id]/clock/page.tsx`.
- `useQuery` `refetchInterval: 2000` sobre `getClock` + contagem regressiva **local** via `setInterval(1000)` calculada de `levelEndsAt` corrigido pelo offset `serverTime - Date.now()`. O poll corrige a deriva; o intervalo local só suaviza a exibição.
- Botões start/pause/resume/next/previous com `useMutation` (feedback imediato + invalidação).
- Form inline para editar o nível corrente.
- Desabilitar botões conforme `clockStatus`.

**Aceite:** pausar em uma aba reflete na outra em ≤ 2s; editar a duração do nível corrente ajusta o restante sem saltos.
**Testes:** RTL com `jest.useFakeTimers`.

---

### `MT-FE-04` · Tela de exibição de blind (TV, somente leitura)
**Dep:** `MT-FE-01`.
- `app/display/tournaments/[id]/page.tsx` — **fora do `AuthLayout`** e sem `RequireAuth`.
- Layout de alto contraste, tipografia grande: nível atual, SB/BB/ante, tempo restante gigante, próximo nível, jogadores restantes, stack médio. `isBreak` mostra o `breakLabel` em destaque.
- **Extrair o hook de countdown/offset para `hooks/use-tournament-clock.ts` e reusar em `MT-FE-03`**, não duplicar.
- Sem `BottomNav`/`TopBar`. Não implementar wake lock preventivamente.
- `aria-live="polite"` só no nível, não no contador de segundos.

**Aceite:** duas TVs abertas simultaneamente mostram o mesmo nível e tempos com defasagem < 3s; um `pause` disparado em `MT-FE-03` aparece em ambas sem reload.
**Testes:** RTL — render `RUNNING`/`PAUSED`/`isBreak`; assert de que não há controle interativo na árvore.

---

### `MT-FE-05` · Mesa/assento no detalhe do torneio (ticket do jogador)
**Dep:** `MT-SH-01`, `MT-BE-04`.
Em `components/tournament/tournament-detail.tsx`: quando `myEntry` existe e tem `tableNumber`, substituir a linha "Você está inscrito neste torneio." (linha 169) por **Mesa X · Assento Y**. No `EntryRow` (linha 248), mostrar mesa/assento junto do chipStack.
**Menor diff do épico e maior valor percebido no caixa.**
**Aceite:** logo após inscrever-se, o jogador vê mesa e assento sem reload.
**Testes:** atualizar `tournament-detail.spec.tsx`.

---

# FASE 1 — Testes dedicados

### `MT-QA-01` · **e2e de concorrência do balanceamento** (o teste que o PRD §10 exige)
**Dep:** `MT-BE-05`. **Gate de "Fase 1 pronta" — sem ele, não fecha.**
Arquivo novo: `apps/backend/test/tournament-tables.e2e-spec.ts` (Postgres real, helpers já prontos em `tournament.e2e-spec.ts:13-62`).

Cenários mínimos:
1. **Distribuição inicial concorrente:** 20 `POST /register` via `Promise.all`, capacidade 9. Assert: 0 assentos duplicados, toda entry com exatamente 1 seat ativo, `max-min <= 1`.
2. **Duas eliminações simultâneas** em mesas diferentes, disparando rebalanceamento. Assert: nenhum jogador em dois assentos, nenhum sem assento, invariante ≤ 1 ao fim, sem moves fantasma de transação abortada.
3. **Quebra de mesa sob concorrência:** eliminações até cruzar o limiar de fechamento, uma delas concorrente. Assert: mesa fechada tem 0 seats ativos, ninguém aponta para mesa `CLOSED`.
4. **Replay de idempotência:** mesmo `Idempotency-Key` duas vezes ⇒ 1 entry, 1 seat, e a segunda resposta traz o mesmo `tableNumber`/`seatNumber`.
5. Se rota (a): eliminação e reentry concorrentes.

**Aceite:** roda 10× seguidas sem flake (`--runInBand`). Flake é bug de concorrência real, investigar antes de fechar.

---

### `MT-QA-02` · Integração: invariantes de schema das tabelas novas
**Dep:** `MT-DB-05`.
Estender `apps/backend/test/schema-invariants.int-spec.ts`. Cenários via `$executeRaw` contornando a aplicação:
- Dois seats `active` no mesmo (mesa, assento) → rejeitado; com um `active = false` → aceito.
- Dois seats `active` para a mesma entry → rejeitado.
- `capacity = 11` ou `= 1` → rejeitado.
- `bigBlind < smallBlind`, `durationSeconds = 0` → rejeitados.
- `clockStatus = 'RUNNING'` com `levelEndsAt` nulo → rejeitado; `'PAUSED'` sem `clockRemainingMs` → rejeitado.
- Rota (a): duas entries `REGISTERED` para o mesmo (torneio, user) → rejeitado; uma `ELIMINATED` + uma `REGISTERED` → aceito.

---

### `MT-QA-03` · e2e do relógio
**Dep:** `MT-BE-07`, `MT-BE-08`.
start → GET display → pause → GET (assert `remainingMs` congelado) → resume → next → PATCH da duração do nível corrente (assert `levelEndsAt` mudou pelo delta exato) → `previous` no nível 1 → 400. GET de display **sem `Authorization`** retorna 200, payload **não** contém `userId`/`email`.

---

### `MT-QA-04` · Frontend — decisão sobre E2E de browser
**Dep:** nenhuma. **Decisão, não implementação.**
Não há Playwright/Cypress no repo. Os critérios "duas telas mostram o mesmo estado" e "pause propaga sem reload" são, a rigor, multi-aba — RTL não cobre.
**Recomendação: não introduzir Playwright neste MVP.** Cobrir com (i) RTL + fake timers em `MT-FE-03`/`MT-FE-04`, (ii) `MT-QA-03` provando que o servidor é a fonte única, (iii) checklist de validação manual de 5 minutos no PR (duas abas + uma TV real). Adicionar Playwright quando houver uma segunda feature multi-tela pedindo.

---

# Grafo de dependências

```
MT-000 (reentry?) ─┬─> MT-DB-06 ──> MT-BE-09        [só rota (a)]
                   └─> (destrava todo o resto)
MT-001 (política) ────> MT-BE-02 ──┬─> MT-BE-04 ──> MT-BE-05 ──> MT-BE-06
MT-002 (polling) ────> MT-BE-08    │                    │
                                   │                    v
MT-DB-01 ─┬─> MT-DB-02 ─> MT-BE-01 ┴─> MT-BE-03         MT-QA-01  ★ gate
          ├─> MT-DB-03 ─────────────> MT-BE-07 ─┐
          └─> MT-DB-04 ─> MT-DB-05 ─> MT-QA-02  ├─> MT-BE-08 ─> MT-QA-03
                    └───> MT-SH-01 ─────────────┘
MT-SH-01 + MT-BE-06/07/08 ──> MT-FE-01 ─┬─> MT-FE-02
                                        ├─> MT-FE-03 ─┐
                                        └─> MT-FE-04 ─┴─ (hook compartilhado)
MT-SH-01 + MT-BE-04 ────────────────────> MT-FE-05
```

**Caminho crítico:** `MT-000` → `MT-001` → `MT-DB-01/04/05` → `MT-BE-02` → `MT-BE-04` → `MT-BE-05` → `MT-QA-01`.

**Ordem sugerida de entrega ao engenheiro:** `MT-000`+`MT-001` (decisão do dono do produto) · `MT-DB-01..05` + `MT-QA-02` (uma PR de schema) · `MT-SH-01` · `MT-BE-02` (função pura, PR isolada e barata de revisar) · `MT-BE-01`+`MT-BE-03` · `MT-BE-04` · `MT-BE-05`+`MT-QA-01` (a PR de risco — review mais lento) · `MT-BE-06` · `MT-BE-07` · `MT-BE-08`+`MT-QA-03` · `MT-FE-01..05`.

---

**Skipped deliberadamente:** WebSocket (polling basta e o throttler já tolera), Playwright (`MT-QA-04`), módulo Nest separado para blinds (mesmo bounded context), abstração `SeatingStrategy` com uma implementação, e reuso de `Table`/`TableSession` para mesa de torneio — forçar o reuso arrastaria `Decimal`/wallet para dentro de fichas de torneio. **Adicionar quando:** WebSocket, quando o polling de N telas aparecer no perfil de carga; Playwright, na segunda feature multi-tela.

**Três coisas que o PRD não previu e que viraram tarefa:** `clockRemainingMs` (`MT-DB-03`), reescrita transacional de `eliminateEntry` antes de estendê-lo (`MT-BE-05`), e `serverTime` no DTO de relógio (`MT-SH-01`) — sem este último, uma TV com relógio desajustado mostra tempo errado mesmo com o servidor autoritativo.
