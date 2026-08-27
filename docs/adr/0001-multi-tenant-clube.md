# 0001 — Arquitetura multi-tenant: o Clube

**Status:** Aceito
**Data:** 26/08/2026
**Contexto de trabalho:** refatoração `CL-*` (multi-tenant Clube)

---

## Contexto

O Casa Cheia foi desenhado como sistema de **uma** casa de poker. Isso aparece em toda parte do schema: `Wallet` tem `userId @unique` (uma carteira por jogador, para sempre), `User.role` é um atributo global da pessoa, `Table` e `Tournament` não pertencem a nada acima deles, e toda query de listagem assume implicitamente que "tudo que está no banco é meu". Enquanto o produto atende um cliente só, isso é correto e barato.

A decisão de produto mudou: o Casa Cheia passa a operar **vários clubes** na mesma instalação. A partir daí, cada uma das premissas acima vira um bug de isolamento em potencial — uma listagem de mesas sem filtro vaza a operação de um clube para o outro, e o saldo de um jogador deixa de ter um significado único.

Este ADR registra o conjunto de decisões que fecham esse desenho. Todas já foram tomadas; o documento existe para preservar o **porquê**, não para reabrir a discussão. O projeto já tem um vocabulário de decisões vinculantes em [`apps/backend/prisma/schema/base.prisma`](../../apps/backend/prisma/schema/base.prisma) (dinheiro em `Decimal`, ledger append-only, lock pessimista, idempotência, separação de fundos); o que segue é a extensão desse mesmo conjunto para o eixo de isolamento entre clubes.

---

## Decisão

### 1. Banco compartilhado com coluna `clube_id` + RLS do PostgreSQL, não um banco por clube

Todo dado de negócio ganha uma coluna `clube_id`, e o isolamento é garantido por Row Level Security do PostgreSQL. Não haverá um banco físico (nem um schema) por clube.

O argumento é de custo operacional, e ele é assimétrico:

- **Migrations.** Um banco por clube significa rodar a mesma migration N vezes, com N crescendo a cada venda, e conviver com o estado intermediário em que metade dos clubes está na versão nova e a outra metade não — o que obriga todo código de aplicação a ser compatível com duas versões de schema ao mesmo tempo, permanentemente. Com banco compartilhado, é uma migration, uma vez, e o schema é sempre um só.
- **Pool de conexões.** Um banco por clube exige um pool por tenant. PostgreSQL cobra caro por conexão ociosa (cada uma é um processo), e um pool por clube com 100 clubes é ou um desperdício grande de memória ou uma camada de roteamento dinâmico de pool que alguém vai ter que escrever e manter. Com banco compartilhado, é um pool só, dimensionado pela carga real e não pelo número de clientes.
- **Relatório consolidado.** Qualquer visão cross-clube — volume total da plataforma, ranking de jogadores que frequentam mais de um clube, conciliação financeira agregada — é, no modelo compartilhado, uma query com `GROUP BY clube_id`. No modelo por banco, é um processo que abre N conexões, varre N bancos e agrega em memória na aplicação, com a garantia de consistência transacional perdida no caminho.

A rota de **banco físico isolado permanece como válvula de escape**, não como arquitetura default: se um cliente específico exigir contratualmente isolamento físico dos dados, a resposta é subir uma instalação dedicada do Casa Cheia para ele — o mesmo código, o mesmo schema, outro banco. Isso é uma decisão comercial pontual, e não deve puxar o desenho de todo o produto atrás dela.

### 2. O conceito se chama `Clube`, não `Tenant`

O modelo é `Clube`, a coluna é `clube_id`, a rota é `/clubes/:clubeId`, a associação é `ClubeMembership`.

`Tenant` é vocabulário de infraestrutura, não de negócio: ninguém no clube de poker chama o próprio clube de "tenant". O codebase já resolve conceitos de domínio em português, e essa é a regra que se mantém: **conceitos de negócio novos são nomeados em português**. `Table`, `Tournament` e `Wallet` continuam em inglês porque são termos já estabelecidos no domínio de poker (e no vocabulário do próprio produto), não porque exista uma preferência geral por inglês — são exceções técnicas herdadas, não o padrão.

### 3. O contexto de clube é resolvido pela rota, não por header

Toda rota com escopo de clube carrega o clube no path: `/clubes/:clubeId/mesas`, `/clubes/:clubeId/torneios`. Não existe `X-Clube-Id`.

Três razões:

- **Auditoria e log de acesso.** A URL já aparece em todo log de acesso, todo APM, todo trace, sem configuração extra. Um header precisa ser explicitamente capturado em cada uma dessas camadas — e, quando alguém for investigar um incidente de vazamento entre clubes, a informação mais importante da requisição não pode ser a que ficou de fora do log.
- **É mais difícil de esquecer.** Um header opcional que, quando ausente, cai num default silencioso é exatamente a forma de bug que este desenho existe para prevenir. Um path param não tem "ausente": ou a rota casa, ou é 404.
- **Cacheabilidade.** A URL é a chave de cache natural em HTTP. Com o clube no path, cache de CDN, de browser e de proxy funcionam sem `Vary` sobre header custom — e sem o risco clássico de um intermediário mal configurado servir a resposta de um clube para outro por ignorar o `Vary`.

### 4. `Wallet` passa a ser por (jogador, clube)

`Wallet` perde `userId @unique` e ganha `@@unique([userId, clubeId])`. Um jogador em três clubes tem três carteiras, com três saldos independentes.

Isso não é uma escolha de modelagem isolada: **decorre diretamente do desenho de sub-conta de gateway por clube** (`ClubePaymentAccount`). Cada clube liquida o próprio dinheiro na própria sub-conta do PSP — é o clube que tem a relação comercial, o CNPJ e o passivo com o jogador. Se o dinheiro está fisicamente separado por clube no gateway, o saldo tem que estar separado por clube no sistema. Uma carteira global única prometeria ao jogador um saldo que não é resgatável em lugar nenhum: o número na tela seria a soma de fundos que vivem em sub-contas distintas, e um saque desse total não teria contrapartida em nenhuma delas. O saldo mostrado tem que ser sempre um saldo sacável.

A regra 5 do `base.prisma` (separação de fundos: dinheiro existe em exatamente um lugar por vez) continua valendo integralmente — apenas passa a valer dentro do escopo de cada clube.

### 5. `clubeId` desnormalizado em `TableSession` e `TournamentEntry`

`TableSession` e `TournamentEntry` carregam `clubeId` próprio, mesmo já tendo o escopo determinado pela FK para `Table` / `Tournament`. Estritamente falando, é redundante — e é deliberado.

- **Simplifica as políticas de RLS.** Sem a coluna, toda policy dessas tabelas vira um `EXISTS (SELECT 1 FROM tables WHERE tables.id = table_sessions.table_id AND tables.clube_id = current_setting(...))`. Isso é um subplano avaliado por linha, em toda leitura e toda escrita, numa policy que precisa ser auditável a olho nu por ser a barreira de segurança final. Com a coluna, a policy é `clube_id = current_setting(...)::uuid` — a mesma frase em toda tabela, trivial de revisar e de indexar.
- **Evita um JOIN em toda query quente.** Listagem de sessões ativas e de inscrições de torneio são caminhos de leitura frequentes; sem a coluna, todas precisam do JOIN com o pai só para filtrar por clube.

É o mesmo raciocínio que já levou o projeto a materializar `Wallet.balance` e `TableSession.currentStack` em vez de recalcular por agregação: aceitar redundância controlada, com invariante explícita, em troca de leitura barata. Como lá, a redundância exige a garantia correspondente — `clubeId` da filha tem que ser igual ao do pai, e essa igualdade é responsabilidade da escrita (a filha só é criada dentro do contexto de clube já resolvido) e da FK composta que amarra filha e pai pelo par `(id, clubeId)`.

### 6. Migration squash única, não expand/backfill/contract

A refatoração entra como **uma migration só**, que reescreve o schema com `clube_id` já no lugar, em vez do roteiro seguro de expand → backfill → contract.

A justificativa é situacional e vale exatamente enquanto a situação valer: **não há dado real em produção hoje**. Não há linha para retrocompatibilizar, não há janela de deploy para coordenar, não há período de dupla-escrita para manter. Nesse cenário, o roteiro em três fases custa três migrations, um job de backfill e semanas de convivência com colunas nullable — para proteger dados que não existem.

Registrado explicitamente para quando a premissa cair: **se houver dado real no banco antes de a migration rodar, a estratégia correta muda para expand → backfill → contract.** Ou seja: (1) adicionar `clube_id` nullable e passar a escrever nos dois formatos; (2) fazer backfill em lotes, decidindo a que clube cada linha histórica pertence; (3) só então tornar a coluna `NOT NULL`, ligar as policies de RLS e remover o caminho antigo. Esse é o roteiro; a única razão de não estarmos seguindo ele agora é a tabela vazia.

### 7. Defesa em profundidade: a aplicação filtra e o banco recusa

O isolamento é garantido em duas camadas independentes, e as duas ficam ligadas ao mesmo tempo:

1. **Aplicação** — uma Prisma Client Extension exposta como `PrismaService.withClube()` injeta o filtro de clube em toda query do request. É o caminho normal, e é o que produz erro claro e código HTTP correto.
2. **Banco** — RLS do PostgreSQL, com a policy checando o clube corrente da sessão. É a barreira que não depende de nenhuma linha de TypeScript estar certa.

Isso não é um padrão novo no projeto: é exatamente o que o financeiro já faz. `WalletService.applyLedgerEntry` valida em aplicação que o saldo não pode ficar negativo, **e** a tabela `wallets` carrega `CHECK (balance >= 0)` (ver [`wallets_balance_non_negative`](../../apps/backend/prisma/schema/migrations/20260821013117_init_schema_integration/migration.sql)) como última barreira, descrita na regra 3 do `base.prisma` como "mesmo diante de um bug de aplicação, saldo negativo é fisicamente impossível". O princípio é o mesmo, aplicado a outro invariante: **o banco garante mesmo se a aplicação tiver um bug.** Um `findMany` que alguém escreveu esquecendo o escopo não vaza dado de outro clube — ele volta vazio, porque o banco recusou.

A camada de aplicação existe porque a de banco sozinha dá uma experiência ruim (resultado vazio em vez de erro nomeado, e nenhuma proteção contra escrita cross-clube antes do round-trip). A camada de banco existe porque a de aplicação sozinha depende de todo desenvolvedor futuro lembrar de uma convenção. Nenhuma das duas justifica desligar a outra.

### 8. `User.role` global é removido; o papel vive em `ClubeMembership.role`

O campo `User.role` sai. O papel do usuário passa a ser um campo de `ClubeMembership`, a tabela que liga jogador e clube.

O motivo é que **papel é uma relação com o clube, não um atributo da pessoa**. Uma pessoa pode ser ADMIN no clube que ela mesma opera e apenas PLAYER no clube do amigo onde joga no sábado — isso não é um caso de borda exótico, é o comportamento esperado assim que existe mais de um clube. Com `role` no `User`, essas duas verdades não cabem na mesma linha, e a única saída seria escolher a mais permissiva das duas, o que é uma escalação de privilégio silenciosa: o admin de um clube viraria admin de todos.

Consequência direta: **não existe mais autorização sem clube resolvido**. O guard de papel passa a depender do `clubeId` da rota (decisão 3) para saber qual membership consultar — o que reforça a escolha do path param, já que um header opcional aqui seria um caminho de autorização com default implícito.

---

## Consequências

**Positivas**

- Uma migration, um pool, uma query para relatório consolidado. O custo operacional cresce com a carga, não com o número de clubes.
- Isolamento com duas camadas independentes: um bug de aplicação não vira vazamento de dados entre clubes.
- Autorização por clube passa a ser expressável — o modelo suporta a pessoa que é admin em um lugar e jogador em outro.
- Saldo do jogador volta a ter um significado único e verdadeiro: o que a tela mostra é o que a sub-conta daquele clube consegue pagar.

**Negativas / custos aceitos**

- Todo dado de negócio passa a ter uma coluna a mais, e toda escrita passa a ter uma invariante a mais para respeitar (`clubeId` da filha == `clubeId` do pai).
- RLS tem custo de plano e é uma camada a menos de familiaridade para quem for debugar uma query: uma consulta feita direto no `psql`, sem o `SET` da sessão, vai parecer que "sumiram dados".
- Jogador em N clubes tem N carteiras, o que exige uma UX explícita de troca de contexto e de saldo por clube — e a pergunta "quanto eu tenho no Casa Cheia?" deixa de ter uma resposta única.
- A migration squash é uma decisão de janela: ela deixa de ser aceitável no dia em que houver dado real (ver decisão 6).
- Isolamento físico por cliente, se vendido, vira instalação dedicada — com custo de infra e de operação próprio, a ser precificado.

---

## Operação da plataforma

Fica em aberto neste ADR a questão de **quem opera a plataforma acima dos clubes**: como funciona o suporte cross-clube, se existe um papel de operador global e como esse acesso se concilia com o isolamento por RLS descrito acima — já que qualquer resposta aqui implica, por definição, uma forma controlada de atravessar a barreira que o resto deste documento existe para levantar.

Essa decisão está sendo tratada em **`CL-RD-03`** e será incorporada a este ADR quando fechada. Até lá, não há resposta definida — e nenhuma implementação deve assumir uma.
