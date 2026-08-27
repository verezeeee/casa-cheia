# ADR 0001: Multi-tenant "Clube"

> Nota: este arquivo é o ponto de convergência de várias tarefas da
> refatoração multi-tenant, decompostas e trabalhadas em paralelo. Cada seção
> abaixo registra uma decisão isolada; o cabeçalho comum (status/contexto
> geral) é preenchido/consolidado pela tarefa que introduz o modelo `Clube` em
> si. Se você está lendo isto numa branch onde outra seção ainda não existe,
> é porque as tarefas ainda não convergiram — sem conflito de fundo, só de
> texto.

## Status

Proposto (em construção incremental, tarefa a tarefa).

## Contexto geral

O sistema está migrando de um modelo single-tenant (uma casa de poker) para
multi-tenant "Clube": múltiplas casas de poker operando na mesma plataforma,
cada uma com seus próprios usuários, mesas, torneios e carteira. O
isolamento entre clubes é reforçado por Row-Level Security (RLS) do
PostgreSQL filtrando por `clube_id`, e o antigo `User.role` (global,
`PLAYER`/`ADMIN`) dá lugar a `ClubeMembership.role` — um papel por clube em
que a pessoa participa (`ADMIN`/`CASHIER`/`TOURNAMENT_DIRECTOR`/`PLAYER`).

---

## Operação da plataforma (CL-RD-03): existe um "staff de plataforma" cross-clube?

### Problema

Com `User.role` removido e todo poder modelado como `ClubeMembership.role`
(por clube), fica uma lacuna: quem opera a PLATAFORMA inteira — suporte ao
cliente, criação de um clube novo, reconciliação financeira cross-clube,
debug de produção? Essa pessoa não necessariamente tem `ClubeMembership` em
clube nenhum, ou teria que ter uma em TODOS os clubes, o que não escala à
medida que clubes são criados.

### Opções consideradas

- **(a) Não existe papel de plataforma no modelo de dados.** Operação
  interna (suporte, criação de clube, reconciliação) usa acesso direto ao
  banco/CLI/scripts administrativos, nunca uma rota HTTP autenticada como
  "super-admin". É a única opção que não exige nenhuma exceção na política
  de RLS.
- **(b) `User.isPlatformStaff: Boolean`.** Flag na identidade global; rotas
  administrativas cross-clube checam essa flag além do RLS, o que exige uma
  exceção na política de RLS para esse caso.
- **(c) "Clube de plataforma" especial.** A equipe do Casa Cheia é modelada
  como `ClubeMembership` num clube fictício com poderes especiais. Reusa o
  mecanismo existente (`ClubeMembership`/`ClubeRole`), mas ainda exige uma
  regra de RLS que reconheça esse clube como especial.

### Levantamento de requisito de produto

Procurado em `README.md` (não há `docs/prds/` neste repositório ainda)
qualquer menção a suporte multi-clube, dashboard interno/cross-clube,
onboarding self-service de novo clube, etc. Não há nenhuma: o README
descreve um sistema de caixa de uma única casa de poker (carteira, mesas,
torneios), sem nenhuma rota, tela ou fluxo hoje que opere sobre mais de um
clube ao mesmo tempo. Não existe requisito concreto — apenas especulação
sobre necessidades futuras de operação.

### Decisão

**Opção (a): não existe papel de plataforma no modelo de dados.**

Justificativa:

1. **RLS sem exceção é a garantia mais forte que a política pode dar.** O
   propósito de RLS filtrando por `clube_id` é tornar estruturalmente
   impossível uma query vazar dado de um clube para outro — a garantia vale
   exatamente na proporção em que ela é *sem exceção*. Introduzir uma
   condição "OU o usuário é staff de plataforma, então ignore o filtro" é
   reintroduzir, em código de aplicação, a mesma classe de bug (autorização
   incorreta vazando dado cross-tenant) que o RLS existe para eliminar
   estruturalmente. Cada linha de exceção é superfície de auditoria e
   superfície de bug a mais, permanentemente, para um caso de uso que hoje
   não tem uma única tela ou requisito documentado.
2. **Nenhum requisito de produto pede uma rota HTTP cross-clube.** Não há
   dashboard interno, suporte self-service, nem onboarding automatizado de
   clube documentado em nenhum lugar do repositório. Sem esse requisito
   concreto, mecanismo de acesso cross-tenant é especulação — exatamente o
   tipo de complexidade antecipada que as convenções deste projeto evitam
   (ver `base.prisma`: `Wallet.balance` materializado só porque há leitura
   quente comprovada, `CHECK (balance >= 0)` só como última barreira sobre
   um invariante que já é garantido em código — nenhum mecanismo é
   introduzido "para o caso de precisar depois").
3. **Acesso direto ao banco já resolve o problema real.** Suporte,
   reconciliação financeira e debug de produção são operações que uma
   pessoa de confiança da equipe interna já precisa fazer com acesso de
   operador de infraestrutura (t)/DBA, não como um "usuário" autenticado do
   produto. Isso é estritamente mais seguro (não há token de sessão de
   staff de plataforma para vazar ou ser roubado; toda ação fica no log de
   acesso ao banco/infra, não num audit log de aplicação que precisaria ser
   construído) e mais simples (zero linhas de código de aplicação).
4. **(b) e (c) resolvem o mesmo problema com mais mecanismo, não menos.**
   Ambas exigem: um novo campo/model, rotas HTTP novas que hoje não existem,
   e — o ponto decisivo — uma exceção de RLS. (c) é marginalmente mais
   consistente com o modelo (reusa `ClubeMembership`), mas "consistência de
   modelo" não paga o custo de enfraquecer a garantia do RLS para um
   requisito inexistente.

Se e quando surgir um requisito concreto de produto (ex.: um dashboard
interno de suporte que precise, via HTTP autenticado, listar clubes,
usuários e transações cross-clube para uma pessoa de suporte não-DBA), essa
decisão deve ser revisitada em um ADR próprio — nesse momento (b)/(c) voltam
à mesa com um requisito real para justificar o custo de RLS.

### Impacto prático nas tarefas dependentes

- **`POST /clubes` (criação de clube) NÃO existe como rota HTTP nesta
  fase.** Não há papel autenticado (nem de plataforma, nem de clube — o
  clube ainda não existe no momento da criação) que devesse ter permissão
  de criar um clube via API. Criação de clube é feita por seed/script
  administrativo rodando com acesso direto ao banco (ex.: `prisma db seed`
  ou uma migration/script one-off), fora do processo HTTP da aplicação. Se
  o produto vier a precisar de self-service de criação de clube por HTTP,
  isso é a própria revisão desta decisão (ver seção anterior), não uma
  exceção pontual.
- **Reconciliação financeira, debug de produção e suporte ao cliente**
  seguem via acesso direto ao banco (psql/scripts administrativos) ou
  ferramentas de infraestrutura, nunca uma rota HTTP da aplicação. Nenhuma
  política de RLS precisa de exceção para "role de plataforma": todo acesso
  administrativo cross-clube acontece fora do caminho que o RLS protege
  (conexão de aplicação autenticada como usuário de produto), não dentro
  dele.
- **Nada muda em `ClubeMembership`/`ClubeRole`**: os únicos papéis que
  existem são os por clube já definidos (`ADMIN`/`CASHIER`/
  `TOURNAMENT_DIRECTOR`/`PLAYER`). Nenhum enum, campo ou tabela nova é
  introduzido por esta decisão.
