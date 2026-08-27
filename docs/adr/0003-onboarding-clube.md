# 0003. Modelo de onboarding de um clube novo (self-service vs. curadoria)

- Status: Aceito
- Data: 2026-08-26
- Tarefa: CL-RD-02

## Contexto

O sistema hoje é single-tenant: uma casa de poker, um caixa, um `AbacatePayClient` configurado por env var (`ABACATEPAY_API_KEY`). A evolução para "Clube" (multi-tenant) introduz a necessidade de dar entrada a um clube novo no sistema — isto é, criar o registro do clube e habilitar sua conta de recebimento no gateway PIX (`ClubePaymentAccount.onboardingStatus`).

Não existe hoje nenhum cliente real além do uso interno. Os primeiros clubes a entrar no produto serão, na prática, escolhidos a dedo pela própria operação do Casa Cheia (parcerias diretas), não um público desconhecido se cadastrando espontaneamente.

Isso é decisão de produto porque destrava trabalho de engenharia concreto:
- a existência (ou não) do endpoint `POST /clubes`;
- a existência (ou não) de uma tela pública de onboarding no frontend;
- se `ClubePaymentAccount.onboardingStatus` tem uma transição `IN_REVIEW` manual feita por humano da operação, ou é 100% automática via API do gateway.

## Decisão

**Curadoria manual, sem tela pública de cadastro, na v1.** Um operador do Casa Cheia provisiona o clube via script/seed administrativo (ou, no máximo, um endpoint interno protegido por `Role.ADMIN`, nunca uma rota pública). Não existe `POST /clubes` público nem tela de onboarding self-service no frontend nesta fase.

Justificativa: com um número pequeno e conhecido de clubes-piloto, self-service é a infraestrutura mais cara (formulário público, validação de CNPJ/dados bancários de fonte não confiável, fila de revisão, comunicação de rejeição, proteção contra abuso/spam de cadastro) para o problema mais barato (a própria operação já sabe quem são os 3–5 primeiros clubes e já fala com eles diretamente). Construir o formulário público agora seria infraestrutura para uma demanda que ainda não existe.

### 1. Quem cria o clube

Um operador do Casa Cheia, via script administrativo (seed/CLI) rodado após due diligence comercial fora do sistema (conversa comercial, contrato, verificação de CNPJ). Não é o dono do clube preenchendo um formulário público.

Consequência direta para engenharia: **não implementar `POST /clubes` como rota pública nesta fase.** Se for necessário um endpoint (em vez de só um script), ele deve ser interno, atrás de `JwtAuthGuard` + `RolesGuard`/`@Roles(Role.ADMIN)`, nunca exposto a usuário não autenticado.

### 2. O que o clube precisa preencher no cadastro

Como o cadastro é feito pelo operador (não pelo dono do clube num formulário), os dados mínimos para criar o registro são coletados manualmente durante a negociação comercial e digitados pelo operador:

- Identificação: nome do clube, CNPJ (ou CPF, se MEI/pessoa física habilitada a operar), razão social.
- Contato operacional: nome e telefone/e-mail do responsável (para incidentes, não é o "cadastro" do jogador final).
- Dados bancários/gateway: os campos exigidos pelo `AbacatePayClient` para criar a conta de recebimento do clube (equivalente ao que hoje é `ABACATEPAY_API_KEY` único, mas por clube) — chave PIX/dados da conta de destino de saque, conforme o contrato de onboarding do gateway.

Esses campos não precisam de tela própria: o script de seed recebe um objeto/CSV com esses dados e chama a mesma lógica de criação de `ClubePaymentAccount` que uma futura tela usaria — ou seja, a validação (`class-validator`/DTO) já pode ser escrita de forma reaproveitável para quando (e se) existir self-service, sem que isso implique construir a tela agora.

### 3. Quem aprova a entrada do clube

Revisão manual, não aprovação automática. A operação do Casa Cheia é quem decide dar entrada em um clube (não há fluxo de "qualquer um se cadastra e já entra"), então a "aprovação" de existência do clube já é, por construção, curada. O que resta como aprovação de fato é o **KYC do gateway de pagamento** (AbacatePay), que roda de forma assíncrona e cujo resultado é externo:

- `onboardingStatus` transiciona `PENDING → IN_REVIEW` quando o operador submete os dados bancários ao gateway (chamada ao `AbacatePayClient` para criar a conta do clube).
- `IN_REVIEW → APPROVED` ou `IN_REVIEW → REJECTED` é reportado pelo gateway — via webhook, se o AbacatePay expuser esse evento para conta/subconta, ou via polling/consulta manual pelo operador caso não exponha. Essa transição **não é um clique de um humano decidindo "aprovar"**; é o resultado do KYC do gateway refletido no sistema. O humano só decide *quando* submeter e pode decidir cancelar/reprovar manualmente um clube problemático (ex: `REJECTED` manual pela operação, independente do gateway, se a parceria comercial for desfeita).

Resumindo: não existe um botão "aprovar clube" na operação do Casa Cheia — existe o resultado do KYC do gateway, refletido no `onboardingStatus`.

### 4. O que um clube em `PENDING`/`IN_REVIEW` pode fazer

Confirma-se a regra original: **nenhuma operação financeira antes de `onboardingStatus = APPROVED`.** Refinamento:

- **Pode**: operações sem dinheiro real — criar mesas de cash game e torneios, cadastrar jogadores/membros do clube, configurar grade de premiação, tudo que é metadado/operação de mesa. Isso permite ao clube "ensaiar" o uso do sistema (treinar operadores, configurar torneios) enquanto o KYC do gateway ainda não terminou, sem risco financeiro.
- **Não pode**: qualquer movimento de dinheiro real — depósito de jogador (PIX de entrada), buy-in pago com saldo real, saque, e por extensão qualquer inscrição em torneio ou sentar em mesa que dependa de débito/crédito de wallet com saldo real. Na prática, isso significa: o clube pode ser criado e configurado em `PENDING`, mas toda rota que chama `WalletService.applyLedgerEntry` (depósito, saque, buy-in, cash-out, inscrição/pagamento de torneio) deve checar `ClubePaymentAccount.onboardingStatus === APPROVED` antes de prosseguir, retornando erro explícito (ex: 403 "clube ainda não aprovado para operações financeiras") caso contrário.
- Consequência para engenharia: o guard/checagem de `onboardingStatus` é responsabilidade do chokepoint financeiro (perto de `applyLedgerEntry` ou nas rotas de depósito/saque/buy-in/inscrição), não da criação da mesa/torneio em si — mesa e torneio continuam funcionando em modo "sem dinheiro" mesmo com o clube pendente.

## Critério para migrar de curadoria manual para self-service

Não é uma decisão definitiva de nunca construir self-service — é uma decisão de **não construir agora**. Revisitar quando **qualquer um** dos critérios abaixo for atingido:

- Mais de ~3 clubes por semana esperando onboarding (fila de espera manual virar gargalo perceptível de operação/vendas).
- Mais de ~10 clubes ativos simultâneos (nesse volume, o script de seed manual já é mais arriscado que um fluxo validado).
- Um canal de aquisição inbound (marketing, parcerias em escala) começar a gerar leads de clube que a operação não consegue mais atender 1:1.

Quando algum desses critérios for atingido, abrir um novo ADR reavaliando `POST /clubes` público + tela de onboarding self-service com fila de revisão assíncrona (aí sim fazendo sentido ter um estado `IN_REVIEW` com um humano revisando o *cadastro do clube*, além do KYC do gateway).

## Consequências

- `POST /clubes` **não é implementado como rota pública** nesta fase; criação de clube é script/seed administrativo (ou endpoint `ADMIN`-only, se necessário para auditoria/repetibilidade).
- **Não há tela pública de onboarding** no frontend nesta fase.
- `ClubePaymentAccount.onboardingStatus` segue o fluxo `PENDING → IN_REVIEW → APPROVED | REJECTED`, onde `IN_REVIEW → {APPROVED, REJECTED}` é dirigido pelo resultado do KYC do gateway (webhook/consulta), não por um botão de aprovação humana interna.
- Toda rota que move dinheiro real (depósito, saque, buy-in, cash-out, inscrição/pagamento de torneio) deve validar `onboardingStatus === APPROVED` do clube antes de operar; criação/configuração de mesas e torneios não tem essa restrição.
- Fica registrado o gatilho de revisão (critérios de volume acima) para não esquecer de revisitar essa decisão conforme o produto cresce.

## Alternativas consideradas

- **Self-service completo desde o dia 1** (`POST /clubes` público + tela de cadastro + aprovação assíncrona por revisão manual de um time de operações): rejeitada por ora. Falta escala que justifique o custo (validação de CNPJ contra fraude, UX de rejeição, moderação, prevenção de abuso de cadastro público) enquanto o número de clubes é pequeno e conhecido.
- **Aprovação 100% automática via API do gateway, sem `IN_REVIEW`**: rejeitada porque o KYC de conta de recebimento de um gateway de pagamento (AbacatePay) tipicamente não é síncrono/instantâneo — precisa existir um estado intermediário no modelo de dados independente de haver ou não uma tela para ele.
