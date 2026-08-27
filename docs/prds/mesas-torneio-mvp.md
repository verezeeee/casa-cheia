# PRD — Mesas de Torneio (MVP)
### Casa Cheia · Módulo de Torneios

**Autor:** rascunho gerado por Claude, a partir do repositório `casa-cheia` e do site institucional da PokerWeb (referência de mercado)
**Data:** 22/08/2026
**Status:** Rascunho para validação

---

## 1. Visão geral e objetivo

O Casa Cheia já resolve, com um desenho técnico sólido, a parte financeira de uma casa de poker: carteira digital com PIX, ledger contábil append-only, mesas de cash game com buy-in/cash-out e um módulo de torneio que cobre criação, grade de premiação, inscrição, eliminação e pagamento automático do prêmio. O que falta — e é o objetivo deste PRD — é tudo o que acontece *dentro* do salão durante um torneio: colocar cada jogador em uma mesa e assento, reorganizar as mesas conforme jogadores são eliminados, e exibir o relógio de blinds de forma sincronizada em múltiplas telas.

Hoje esse é o maior gap funcional entre o Casa Cheia e uma referência de mercado como a PokerWeb, cujo site institucional (`pokerweb.com.br/clube/funcionalidades`) foi usado como benchmark para este documento. No código do Casa Cheia, o modelo `TournamentEntry` não tem nenhum campo de mesa ou assento, e o modelo `Table` — que já tem um enum `TableType.TOURNAMENT` — nunca é de fato usado por um torneio; ele só é criado e operado pelo fluxo de cash game (buy-in em dinheiro, stack em `Decimal`). Ou seja: a "mesa de torneio" ainda não existe como conceito no sistema, apenas como um valor de enum não utilizado.

Este MVP entrega as três capacidades que você priorizou: (1) mesa e posição automáticas na inscrição, (2) quebra de mesas e redraw conforme o torneio esvazia, e (3) telas de blind sincronizadas entre múltiplos displays. As demais funcionalidades do PokerWeb (sangeur, app gerencial completo, ranking, chipcount de Dia 2, financeiro do torneio, bar/restaurante, GameID etc.) ficam mapeadas na seção de próximos passos, fora do escopo deste MVP.

## 2. Fontes

O levantamento de funcionalidades de referência veio da página `https://pokerweb.com.br/clube/funcionalidades`, seção "Torneios" (Estruturas de blinds, Estruturas de itens, Criação do torneio, Inscrição, Mesa e posição automáticas, Telas de blinds, Premiação, Ranking, Sangeur, Financeiro do torneio, Chipcount, Aplicativo gerencial). O estado atual do Casa Cheia foi extraído diretamente do repositório `github.com/verezeeee/casa-cheia`: README, schema Prisma (`identity`, `wallet`, `table`, `tournament`), services e controllers de `table` e `tournament`, e os DTOs/contratos compartilhados em `packages/shared`.

## 3. Estado atual do Casa Cheia (o que já existe)

O backend é NestJS + Prisma sobre PostgreSQL, com frontend em Next.js (PWA). A arquitetura financeira é o ponto mais maduro do projeto: todo dinheiro é `Decimal(14,2)`, todo saldo é um ledger append-only com coluna materializada (`Wallet.balance`, `TableSession.currentStack`), toda operação financeira exige `Idempotency-Key`, e há lock pessimista na wallet e lock otimista (`version`) em `Table`/`Tournament`. Esse padrão é a base sobre a qual o MVP de mesas de torneio deve ser construído — não faz sentido introduzir um padrão de concorrência diferente para mesas e blinds.

Especificamente no módulo de torneio, hoje é possível: criar um torneio com nome, buy-in, fee, stack inicial, número máximo de jogadores, data/hora e uma grade de premiação (percentuais que precisam somar 100%); um jogador se inscrever, debitando `buyIn + fee` da wallet e recebendo `chipStack` fichas; um admin marcar a eliminação de uma inscrição, opcionalmente com colocação final; e encerrar o torneio, momento em que o sistema infere o campeão (quando resta só uma inscrição ativa) e paga a grade automaticamente, de forma idempotente.

Duas limitações estruturais do schema atual pesam diretamente sobre este MVP. A primeira é que `TournamentEntry` tem uma constraint `@@unique([tournamentId, userId])` — um jogador só pode ter **uma** inscrição por torneio, para sempre. Isso significa que o schema atual não suporta reentry nem rebuy: um jogador eliminado não pode comprar uma nova entrada no mesmo torneio. A segunda é que não existe nenhum modelo de blind (estrutura, nível, relógio) nem qualquer relação entre `TournamentEntry` e um lugar físico (mesa/assento) — o módulo de torneio hoje só sabe "quem está inscrito, quantas fichas tem, e se foi eliminado", sem nenhuma noção de onde essa pessoa está sentada.

## 4. Comparativo PokerWeb × Casa Cheia — recursos priorizados

| Recurso (PokerWeb) | Casa Cheia hoje | Gap |
| --- | --- | --- |
| Mesa e posição automáticas | Não existe — `TournamentEntry` não referencia mesa/assento | Total |
| Quebra de mesas / redraw (via app gerencial) | Não existe — não há noção de mesa de torneio nem de balanceamento | Total |
| Telas de blinds sincronizadas, editáveis, com presets | Não existe — nenhum modelo de blind/relógio no schema | Total |
| Estruturas de itens (buy-in, reentry, rebuy, addon) | Só buy-in único (`buyIn` + `fee` fixos no torneio); reentry bloqueado por constraint | Parcial/bloqueador |
| Financeiro do torneio integrado ao caixa | Ledger de wallet já existe e é reaproveitável (`TOURNAMENT_BUY_IN`/`TOURNAMENT_PAYOUT`) | Baixo — infraestrutura já pronta |

O último gap listado, reentry/rebuy, não estava no seu recorte de prioridades, mas está marcado como bloqueador porque a mecânica de "quebra de mesas" só faz sentido operacional em torneios que permitem reentrada (a maioria dos torneios de clube no Brasil permite). Se o MVP for entregue sem isso, a funcionalidade de mesas fica correta tecnicamente mas incompleta para o uso real do clube. Ver seção 7.

## 5. Escopo do MVP

### 5.1 Mesa e posição automáticas

Ao confirmar uma inscrição (fluxo já existente de `registerEntry`), o sistema atribui automaticamente uma mesa e um assento ao jogador, sem qualquer sorteio manual, e essa informação fica disponível para o caixa/jogador imediatamente (ticket com número da mesa e assento). O admin define, na criação do torneio ou ao abrir o registro, a capacidade por mesa; o sistema abre novas mesas conforme necessário e distribui os jogadores de forma equilibrada entre as mesas abertas — nunca deixando uma mesa com muito mais jogadores que outra enquanto houver mesas com vagas.

Critérios de aceite: dois jogadores nunca ocupam o mesmo assento da mesma mesa ativa; a atribuição é idempotente (reenviar a mesma inscrição com a mesma `Idempotency-Key` não gera um segundo assento); a diferença de ocupação entre a mesa mais cheia e a mais vazia nunca passa de 1 jogador no momento da distribuição inicial.

### 5.2 Quebra de mesas e redraw

Conforme jogadores são eliminados (fluxo já existente de `eliminateEntry`), o sistema reequilibra as mesas automaticamente: se uma mesa fica com muito menos jogadores que as demais, jogadores de mesas mais cheias são movidos para equalizar; quando o total de jogadores permite fechar uma mesa inteira, ela é "quebrada" e todos os seus ocupantes são redistribuídos nas mesas remanescentes, e a mesa some da operação. Além do balanceamento automático, o admin/diretor de torneio pode disparar manualmente um redraw completo (redistribuição total dos jogadores ainda vivos), tipicamente usado na virada de um torneio classificatório para o Dia Final.

Critérios de aceite: toda movimentação de jogador entre mesas fica registrada (mesa/assento de origem e destino, motivo — balanceamento automático, quebra de mesa ou redraw manual —, quando e por quem, se manual); a operação é transacional (nunca deixa um jogador "no ar" sem assento); a regra clássica de balanceamento de torneio é respeitada (nunca duas mesas diferem em mais de 1 jogador quando houver mesas com vaga suficiente para equalizar).

### 5.3 Telas de blinds sincronizadas

O admin cria e reutiliza estruturas de blind (presets): uma lista de níveis com small blind, big blind, ante opcional, duração e, quando aplicável, se o nível é um intervalo (pausa) com um rótulo próprio. Ao criar um torneio, uma estrutura preset é aplicada e copiada para o torneio (editar o preset depois não deve alterar torneios já criados a partir dele). Durante o torneio, o diretor de torneio controla o relógio a partir de uma tela de operação: iniciar, pausar, retomar, avançar de nível, voltar de nível, e ajustar a duração/valores de um nível específico em tempo real. Qualquer tela conectada (TV do salão, notebook, celular) mostra o mesmo estado — nível atual, blinds, ante, tempo restante e próximo nível — porque o servidor é a fonte única de verdade do relógio; um pause em uma tela reflete em todas as outras.

Critérios de aceite: todas as telas conectadas ao mesmo torneio mostram o mesmo nível e o mesmo tempo restante, com defasagem aceitável de poucos segundos; pausar/retomar/avançar o relógio em qualquer ponto de controle autorizado propaga para todas as telas sem exigir reload manual; editar a duração de um nível em andamento não quebra a contagem das telas já abertas.

## 6. Modelo de dados (proposta)

A proposta segue as convenções já estabelecidas no schema (`id` UUID, timestamps, `@@map` em snake_case, `version` para lock otimista onde há concorrência de escrita, tabelas separadas por bounded context).

Para blinds, dois modelos novos: `BlindStructure` (preset reutilizável, pertence ao clube/admin) com uma lista de `BlindLevel` (número do nível, smallBlind, bigBlind, ante, duração em segundos, flag `isBreak`, rótulo do intervalo). O `Tournament` ganha um campo opcional `blindStructureId` apontando para o preset usado como origem, mas os níveis efetivos do torneio são copiados para uma tabela própria, `TournamentBlindLevel`, no momento da criação — assim, editar o preset depois não afeta torneios já criados a partir dele. O `Tournament` também ganha o estado do relógio: `clockStatus` (`NOT_STARTED` / `RUNNING` / `PAUSED` / `FINISHED`), `currentLevelNumber`, e `levelEndsAt` (timestamp absoluto calculado pelo servidor a cada start/resume/avanço de nível — os clientes de exibição calculam a contagem regressiva localmente a partir desse timestamp, em vez de o servidor empurrar um tick por segundo).

Para mesas e assentos de torneio, dois modelos novos, deliberadamente separados de `Table`/`TableSession` (que são o vocabulário de cash game, com stack em dinheiro e ligação direta com a wallet — uma mesa de torneio não tem buy-in em dinheiro nem cash-out, só fichas de torneio, que já vivem em `TournamentEntry.chipStack`): `TournamentTable` (id, tournamentId, número da mesa, capacidade, status `OPEN`/`CLOSED`) e `TournamentSeat`, que amarra uma `TournamentEntry` a uma `TournamentTable` e a um número de assento, com um campo `active` e um `reason` (`INITIAL`, `BALANCE`, `BREAK`, `MANUAL_REDRAW`) — cada realocação cria uma nova linha em vez de sobrescrever a anterior, preservando o histórico de movimentação como uma trilha auditável, no mesmo espírito do ledger financeiro que já existe no projeto. Um índice único parcial garante que só exista uma linha `active` por assento por mesa e uma `active` por inscrição, o mesmo padrão parcial-unique já usado em `TableSession`.

## 7. Dependência bloqueadora: reentry/rebuy

O schema atual impede um jogador de se inscrever duas vezes no mesmo torneio (`@@unique([tournamentId, userId])` em `TournamentEntry`). Isso não fazia parte do seu recorte de prioridades para este MVP, mas afeta diretamente a mecânica de quebra de mesas: em um torneio real com reentry, um jogador eliminado costuma comprar uma nova entrada e ser sentado de novo, o que hoje é estruturalmente impossível no banco. Recomendamos decidir explicitamente uma de duas rotas antes de iniciar a implementação: (a) incluir reentry/rebuy simples no escopo deste MVP — o que exige remover a constraint de unicidade, criar índice único parcial equivalente ao de `TableSession` (uma inscrição `active`-equivalente por vez) e uma pequena extensão de `CreateTournamentDto` para permitir reentry configurável (com ou sem limite de reentradas, até qual nível) —, ou (b) manter fora do escopo e assumir, para efeito deste MVP, que os torneios operados serão sempre freezeout (sem reentrada). A opção (a) é a mais próxima do que a PokerWeb oferece e do uso real de clube; a decisão final é sua.

## 8. Fora de escopo deste MVP

Ficam explicitamente fora deste ciclo, mapeados para fases futuras na seção 9: estruturas de itens completas (rebuy/addon como produtos configuráveis com taxa e limite de compra — distinto da decisão binária da seção 7), Sangeur (venda nas mesas via celular), aplicativo gerencial mobile nativo, ranking/temporada, chipcount e transporte para Dia 2/Dia Final, financeiro do torneio como módulo dedicado (despesas, rake, centro de custo), bar & restaurante, jackpot, GameID (autocadastro do jogador), dashboard consolidado, relatórios, e autenticação em duas etapas (2FA) — a PokerWeb já tem, o Casa Cheia ainda não.

## 9. Próximos passos (roadmap sugerido)

**Fase 0 — decisão e preparação.** Decidir a questão de reentry/rebuy (seção 7); definir a estratégia de sincronização das telas de blind — para este MVP, a recomendação é polling leve (1–2s) do endpoint de estado do relógio, já que o servidor é autoritativo sobre `levelEndsAt` e o cliente só precisa calcular a contagem regressiva localmente; WebSocket fica como otimização de fase posterior, quando o número de telas simultâneas justificar reduzir a carga de polling e ganhar latência menor em eventos de pausa/avanço.

**Fase 1 — MVP deste PRD.** Modelos de dados da seção 6; endpoints de CRUD de `BlindStructure`/`BlindLevel`; extensão de `createTournament` para aceitar uma estrutura de blind e (se a decisão da seção 7 for "sim") parâmetros de reentry; lógica de distribuição inicial de assentos acoplada a `registerEntry`; lógica de balanceamento/quebra de mesa acoplada a `eliminateEntry`; endpoint de redraw manual; endpoints de controle do relógio (start/pause/resume/next/previous/edit nível) restritos a `ADMIN`; endpoint público de leitura do estado do relógio e do mapa de mesas, para as telas de TV e para o jogador acompanhar onde está sentado; telas no frontend: visão de mesas do torneio (staff), visão de controle do relógio (staff) e tela de exibição de blind (somente leitura, pensada para rodar em TV/monitor).

**Fase 2 — item structures e financeiro do torneio.** Produtos configuráveis por torneio (buy-in, reentry, rebuy, addon) com valor, quantidade de fichas, taxa administrativa e limite de compra por jogador — generaliza a decisão binária da Fase 0/seção 7 em algo tão flexível quanto a "Estrutura de itens" da PokerWeb; financeiro do torneio como visão dedicada (arrecadação, rake, taxas, prize pool) reaproveitando o ledger que já existe.

**Fase 3 — operação em campo.** Sangeur (venda nas mesas via celular, reaproveitando os endpoints de item structure da Fase 2); aplicativo gerencial mobile cobrindo venda de itens, controle de mesas (mover/eliminar/quebrar/redraw) e controle do relógio a partir do celular — hoje isso teria que ser feito pelas telas web já entregues na Fase 1, o app nativo/PWA dedicado é incremento de usabilidade, não de funcionalidade nova.

**Fase 4 — retenção e crescimento.** Ranking (fórmulas de pontuação, temporada, multiplicadores), chipcount e transporte de stack para Dia 2/Dia Final (torneios classificatórios), GameID (autocadastro do jogador), dashboard consolidado e relatórios, jackpot, bar & restaurante, 2FA.

## 10. Riscos e pontos em aberto

O balanceamento automático de mesas é a peça de maior risco de implementação: é fácil descrever a regra ("nunca deixe duas mesas diferirem em mais de 1 jogador") e fácil errar a implementação sob concorrência (duas eliminações quase simultâneas disparando rebalanceamento ao mesmo tempo). Recomendamos tratá-lo com o mesmo rigor de teste que já existe no financeiro (testes e2e contra Postgres real, não só mocks) antes de considerar a Fase 1 pronta. Também fica em aberto, e não coberto por este PRD, a política exata de rebalanceamento (mover sempre da mesa mais cheia para a mais vazia? evitar mover quem acabou de ser movido? existe um "limite de trocas" por jogador?) — recomendamos validar essa regra com quem toca o salão hoje, provavelmente você mesmo ou o diretor de torneio do clube, antes de travar a especificação técnica.
