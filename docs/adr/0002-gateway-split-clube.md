# 0002 — Gateway de pagamento para sub-conta por clube com split PIX

- Status: Proposta (spike técnico — `CL-RD-01`)
- Data: 2026-08-26
- Autor: engenharia (spike), via Claude Code

## Contexto

O `casa-cheia` hoje processa PIX através do **AbacatePay**
(`apps/backend/src/integrations/abacatepay/`). Essa integração:

- fala com uma única conta do gateway (uma `API key` só, em
  `AbacatePayConfig`/`configuration.ts`);
- cria cobrança PIX avulsa (`POST /transparents/create`) e saque PIX para
  chave de terceiro (`POST /pix/send`) — ver `abacatepay.client.ts`;
- não tem qualquer noção de sub-conta, KYC de terceiro ou split — todo
  dinheiro entra e sai de uma conta só;
- resolve o webhook inteiro para essa conta única
  (`AbacatePayWebhookController` → `WalletService.handleWebhook`,
  autenticado por UM segredo HMAC de config, `x-abacatepay-signature`).

O schema atual (`apps/backend/prisma/schema/wallet.prisma`) reflete esse
desenho: `PixCharge`/`PixWithdrawal` pertencem a um `User` (jogador), a
`Wallet` é 1:1 com `User`, e `WebhookEvent` desduplica por
`@@unique([provider, externalEventId])` — sem qualquer coluna de
tenant/clube.

A refatoração multi-tenant "Clube" precisa que **cada clube tenha sua
própria sub-conta de recebimento no gateway**, para que o dinheiro de
cada clube fique fisicamente segregado (compliance, auditoria, e
capacidade de cada clube sacar seu próprio saldo sem depender da conta
mestre da plataforma). Isso exige um modelo `ClubePaymentAccount` (ainda
não existente no schema) com, no mínimo, `provider`, `externalAccountId`,
`onboardingStatus` e `rawOnboardingPayload`, e um fluxo de:

1. onboarding programático da sub-conta do clube (KYC);
2. cobrança PIX com split nativo (o valor já cai dividido entre a
   sub-conta do clube e a plataforma, sem transferência manual
   posterior);
3. saque da sub-conta do clube para a conta bancária do clube;
4. webhook que informe de forma inequívoca a qual sub-conta/clube um
   evento pertence, com segredo próprio por sub-conta (o padrão atual de
   "um segredo global" não escala para N clubes).

Esta tarefa é só o spike de pesquisa (`CL-RD-01`): nenhuma dependência
nova nem código de integração é adicionado; o objetivo é decidir o
gateway e deixar documentado o roteiro de sandbox para quem implementar
depois.

## Critérios avaliados

1. **Sub-conta por clube via API, com KYC programático** (não
   manual/humano por padrão).
2. **Split nativo no recebimento PIX** — o dinheiro já cai dividido, não
   é uma transferência posterior manual.
3. **Saque/payout** da sub-conta para a conta bancária do clube.
4. **Webhook com segredo por sub-conta/evento**, para rotear o evento ao
   clube certo.
5. **Sandbox testável em CI** — documentação de sandbox, rate limits, se
   dá para automatizar.

## Comparação

| Critério | Asaas | Iugu | Pagar.me (v5) | Stripe Connect (BR) |
|---|---|---|---|---|
| **(1) Sub-conta + KYC programático** | `POST /v3/accounts` cria a sub-conta e devolve `apiKey`+`walletId` na hora. Onboarding roda em "avaliação regulatória automática" quando possível; só cai em fila humana (`AWAITING_APPROVAL`) quando a automática falha — ver mapeamento de status abaixo. | `POST /v1/marketplace/create_account` cria, mas a verificação exige upload de documentos (RG/CNH + selfie, base64) e o status inicial documentado é `pending_manual_analysis`, com aprovação em **até 2 dias úteis**. É explicitamente revisão humana por padrão. | `POST /v5/recipients` pede um KYC extenso (CPF/CNPJ, renda, endereço, sócios) e desde a resolução do Bacen sobre prova de vida, o fluxo `kyc_details` inclui uma etapa de **liveness/selfie** adicional. Não há confirmação pública de aprovação automática — o padrão de mercado é revisão em backend. | Contas `custom` via `POST /v1/accounts` com `country=BR` e capabilities `card_payments`/`transfers`/`pix_payments`; o hash `requirements` é 100% programático (a própria Stripe é referência em automação de KYC). Mas o combo BR+Pix+Connect é recente — Stripe publicou em 2026 uma atualização de requisitos de verificação específica para contas conectadas no Brasil, sinal de que o fluxo ainda está amadurecendo. |
| **(2) Split nativo no PIX** | Sim — `walletId` + `fixedValue`/`percentualValue` no payload da cobrança; split é agnóstico ao meio de pagamento (PIX, boleto, cartão) e calculado sobre o valor líquido no momento da liquidação. | Sim, no Plano Marketplace — split configurável por Master/Subconta para PIX, boleto e cartão. | Sim — `split_rules` no `order`/`charge`, com `recipient_id` de cada recebedor; documentado para PIX. | Sim, via *destination charges* (`transfer_data[destination]` + `application_fee_amount`) — mas depende de a sub-conta ter as capabilities `transfers`+`pix_payments` ativas, e a combinação Pix+Connect tem bem menos exemplos/husos documentados que os 3 PSPs nacionais. |
| **(3) Saque da sub-conta** | Sim — `POST /v3/transfers` da sub-conta para conta bancária externa (TED/PIX) ou chave PIX; PIX é instantâneo, TED cai no mesmo dia útil ou no seguinte. | Sim — saque padrão da API de contas/subcontas iugu para conta bancária cadastrada. | Sim — recebedor tem saldo próprio e agenda de saque (`POST /v5/recipients/{id}/withdrawals`) para a conta bancária vinculada. | Sim — `payouts_enabled` na conta conectada libera repasse automático (schedule) ou manual para a conta bancária BRL vinculada; ciclo de repasse padrão de ~2 dias úteis. |
| **(4) Webhook com segredo por sub-conta** | Sim, de forma explícita: `authToken` obrigatório por webhook, e o array `webhooks` pode ser enviado já na criação da sub-conta — dá pra emitir um segredo único por clube desde o dia 1. | Parcial — cada subconta tem tokens de API próprios (`user_token`/`live_api_token`), mas a documentação pública não confirma um segredo de *webhook* dedicado por subconta (o roteamento tende a depender do `account_id` embutido no payload, não de um segredo diferente por assinatura). | Parcial — webhooks são configurados a nível de conta/loja; o payload traz o `recipient_id`, mas não há segredo de assinatura por recebedor documentado — a plataforma inteira usa a mesma assinatura de webhook. | Parcial/mais trabalhoso — o segredo de assinatura é por *endpoint* (não por conta conectada); o roteamento correto usa o campo `account` do Event, então dá pra rotear, mas o segredo em si continua compartilhado entre todas as contas conectadas do mesmo endpoint, salvo criar um endpoint por conta conectada (viável, mas não é o padrão recomendado pela Stripe). |
| **(5) Sandbox testável em CI** | `api-sandbox.asaas.com`, ambiente isolado com dados fictícios, e a criação de sub-conta pode ser **auto-aprovada em Sandbox** para não depender de análise manual no teste. Limitação real: a confirmação de pagamento de uma cobrança PIX simulada hoje só tem botão na UI (não há endpoint de API documentado para "pagar" a cobrança), o que limita a automação 100% headless em CI. | Sandbox documentado (`test_api_token`), mas a exigência de verificação em até 24h após criação da subconta e a análise manual tornam o fluco de subconta pouco reprodutível em CI sem mocks. | Ambiente de teste existe, inclusive para o novo fluxo de prova de vida ("Ambiente de teste para prova de vida"), mas a documentação pública sobre simulação automatizada (via API, sem UI) de split PIX é escassa. | Modo de teste robusto e maduro (chaves `sk_test_*`, webhooks de teste, `stripe trigger`), mas para o cenário específico Connect+Pix+BR a documentação e os exemplos de teste são mais rasos que os dos PSPs nacionais — o recurso mais novo tende a ter sandbox menos "batido" para esse caso de uso. |

## Decisão

**Escolhemos o Asaas** como gateway para as sub-contas por clube com
split de PIX.

Justificativa, em ordem de peso:

1. É o único dos quatro em que a aprovação de sub-conta pode ser
   **automática por padrão** (cai em fila manual só como exceção,
   quando a automática falha) — os outros três documentam explicitamente
   revisão humana (Iugu: `pending_manual_analysis`, até 2 dias úteis;
   Pagar.me: KYC extenso + prova de vida sem aprovação automática
   documentada; Stripe: fluxo mais novo para BR, com requisitos ainda em
   atualização em 2026). Isso importa porque o produto quer permitir
   que um clube comece a operar (mesmo que com limites) no mesmo dia do
   cadastro.
2. Split nativo, agnóstico ao meio de pagamento e via um único campo
   (`walletId`) — o desenho mais simples de mapear para
   `ClubePaymentAccount` entre os quatro.
3. É o único que expõe, sem ambiguidade na documentação, um segredo de
   webhook (`authToken`) configurável **por sub-conta desde a criação**
   — resolve diretamente o problema descrito no contexto
   (`AbacatePayWebhookController` hoje só sabe validar UM segredo global;
   com Asaas, cada `ClubePaymentAccount` carrega o seu).
4. Documentação e suporte 100% em pt-BR, o que reduz risco de
   interpretação errada de um contrato financeiro — ponto que pesa mais
   aqui do que em uma escolha de fornecedor genérico, dado o histórico
   do próprio client do AbacatePay (`abacatepay.client.ts`) de precisar
   confirmar contratos "contra o client oficial" por falta de clareza
   da doc pública.
5. Stripe Connect é tecnicamente competente (aliás, o mais maduro em
   automação de KYC no geral), mas para o caso de uso concreto —
   Brasil-only, poucos clubes, equipe pequena — o custo de integração
   (documentação majoritariamente em inglês, combo Pix+Connect+BR
   recente e com requisitos "em atualização", cobrança em USD com
   conversão, necessidade de contato com sales para alguns cenários de
   cross-border) não se paga frente ao ganho. Fica como alternativa se o
   produto for internacionalizar.

Não é uma decisão de "o Asaas é objetivamente superior em tudo" — é a
decisão certa **para este produto, agora**: Brasil-only, poker clubs
pequenos/médios, e uma dependência forte de fricção mínima no onboarding
do clube.

## Mapeamento para `ClubePaymentAccount`

O model ainda não existe no schema; este é o contrato que a
implementação (fora do escopo deste spike) deve seguir.

| Campo `ClubePaymentAccount` | Origem no Asaas | Observação |
|---|---|---|
| `provider` | constante `"ASAAS"` | Igual ao padrão já usado em `WebhookEvent.provider` (hoje `"abacatepay"`) — mesma convenção, string minúscula/snake por consistência: usar `"asaas"`. |
| `externalAccountId` | campo `id` da resposta de `POST /v3/accounts` (ex.: `"acc_000000000001"`) | É o identificador da sub-conta em si (usado para consultar status, atualizar dados, etc). **Atenção**: o `walletId` (necessário no payload de split de cada cobrança) é um campo *diferente* devolvido na mesma resposta. Como o contrato do model só prevê `externalAccountId`, a implementação real vai precisar de uma coluna adicional (`providerWalletId String?`, por exemplo) — deixado registrado aqui como gap descoberto por este mapeamento, não resolvido neste spike. |
| `onboardingStatus` | campo `general` de `GET /v3/myAccount/status/` (consultado com a `apiKey` da sub-conta) | Mapeamento de enum: `PENDING` → `PENDING`; `AWAITING_APPROVAL` → `IN_REVIEW`; `APPROVED` → `APPROVED`; `REJECTED` → `REJECTED`. O mesmo endpoint também devolve `commercialInfo`, `bankAccountInfo` e `documentation` com os mesmos 4 valores — a implementação real deve decidir se guarda só o `general` (mais simples, suficiente para gating de "pode operar?") ou os 4 dentro de `rawOnboardingPayload` para diagnóstico fino (recomendado: os 4, exatamente para evitar suporte às cegas quando o clube perguntar "por que ainda tá pendente"). |
| `rawOnboardingPayload` (Json) | corpo bruto de `POST /v3/accounts` (resposta de criação) **+** o corpo bruto do último `GET /v3/myAccount/status/` | Mesmo padrão já usado em `PixCharge.rawPayload` — preservar a resposta crua para auditoria e reprocessamento em caso de mudança de contrato do provedor (o próprio código do AbacatePay já demonstra a necessidade disso: `abacatepay.client.ts` tolera nomes de campo alternativos porque a doc pública nem sempre bate com a resposta real). |

## Custo e fluxo de KYC

**O que o clube precisa fornecer** (pessoa jurídica, caso mais comum de
um clube formalizado):

1. Dados cadastrais: razão social, CNPJ, `incomeValue` (faturamento
   mensal estimado — obrigatório por exigência regulatória do próprio
   Asaas), endereço completo, telefone.
2. Dados bancários (ou usar a própria conta Asaas gerada — não é
   obrigatório ter banco externo para operar, só para sacar).
3. Documentos (quando a aprovação automática não acontece e a conta cai
   em análise): documento do responsável legal + comprovação da empresa.

**Tempo típico:**

- Aprovação automática (quando aplicável): efetivamente imediata —
  a sub-conta já nasce operacional.
- Quando cai em análise manual (`AWAITING_APPROVAL`): até 48h conforme a
  documentação do Asaas.
- Além disso, toda conta nova criada via API passa por um **período de
  avaliação regulatória** com limites de quantidade/valor de cobranças e
  sub-contas até a Asaas "confiar" no volume do integrador — isto é,
  mesmo com aprovação automática do clube individual, a *plataforma*
  (nossa conta mestre) pode ter throttling próprio nos primeiros
  clubes/cobranças. Isso deve ser levado em conta no rollout (não lançar
  para todos os clubes no mesmo dia).

**Custo** (tarifário padrão público, sujeito a negociação por volume):

- PIX recebido por chave/QR estático: gratuito nas primeiras 100
  transações/mês da conta; R$ 0,99/transação nos primeiros 3 meses,
  R$ 1,99/transação depois disso.
- Split: sem tarifa adicional própria documentada além das tarifas do
  meio de pagamento já cobradas (PIX/boleto/cartão) — quem paga a tarifa
  (conta principal ou sub-conta) é configurável nos parâmetros globais
  de split.
- Saque (transferência para fora do Asaas): tarifado por TED/PIX,
  conforme contrato; transferência **entre contas Asaas** (matriz ↔
  sub-conta) não passa pela mesma tarifa de saída bancária.
- Sem mensalidade fixa documentada para a sub-conta em si — é "pague por
  cobrança recebida", que é o mesmo modelo de precificação do
  AbacatePay hoje, o que facilita a comparação de custo real após o
  rollout.

## AbacatePay em paralelo ou troca completa?

**Recomendação: manter o AbacatePay rodando em paralelo**, não trocar de
uma vez.

Justificativa:

- O AbacatePay hoje atende exclusivamente `Wallet`/`PixCharge`/
  `PixWithdrawal` do **jogador** (saldo individual, sem noção de clube).
  Essa função continua válida e não tem nenhuma exigência de split — não
  há motivo técnico para migrá-la.
- O Asaas resolve um problema que o AbacatePay *não resolve de jeito
  nenhum* (sub-conta + split por clube) — não é uma dúvida de "qual dos
  dois usar", é "qual usar para o caso novo".
- Migrar o fluxo de carteira do jogador (que já está em produção, com
  `PixCharge`/`PixWithdrawal`/`WebhookEvent` maduros e testados —
  `wallet.service.spec.ts`, `wallet.e2e-spec.ts`) só para consolidar em
  um único PSP é risco desnecessário: toca ledger financeiro em produção
  sem ganho funcional imediato para o usuário.
- `WebhookEvent.provider` já é uma `String` livre (não um enum fechado),
  então o schema já suporta múltiplos providers coexistindo sem
  migração de schema para o Asaas ser adicionado — o único ajuste
  necessário no controller de webhook é rotear por `provider` na URL/
  path (`webhooks/asaas` novo, ao lado de `webhooks/abacatepay`
  existente), não uma reescrita.
- Consolidar tudo em um único PSP no futuro é uma decisão de produto
  válida (menos contratos para gerenciar, menos superfície de
  integração), mas deve vir depois que o modelo de sub-conta por clube
  provar valor em produção — não faz sentido pagar esse custo de
  migração antes de validar a features em si.

## Roteiro de sandbox (Asaas) — não executado, baseado em documentação oficial

Não foi possível obter uma chave de sandbox própria dentro deste spike
(o Asaas exige cadastro de conta, ainda que gratuito, antes de emitir
uma API key de Sandbox — não há chave pública compartilhada documentada
para testes anônimos). O roteiro abaixo é reproduzível por qualquer
pessoa com uma conta Asaas gratuita, seguindo a documentação oficial
(`docs.asaas.com`).

### Passo 0 — conta e chave de sandbox

1. Criar conta em `https://sandbox.asaas.com` (gratuita).
2. Menu → Integrações → Chave de API → copiar a `apiKey` de Sandbox.
3. Todas as chamadas abaixo usam `baseURL = https://api-sandbox.asaas.com/v3`
   e o header `access_token: $API_KEY` (Sandbox e produção são
   ambientes isolados; a chave de um não funciona no outro).

### Passo 1 — criar a sub-conta do "clube" de teste

```http
POST /v3/accounts
access_token: {SANDBOX_API_KEY}
Content-Type: application/json

{
  "name": "Clube Teste CL-RD-01",
  "email": "clube-teste@example.com",
  "cpfCnpj": "04252011000110",
  "companyType": "LIMITED",
  "mobilePhone": "11999999999",
  "incomeValue": 5000,
  "address": "Rua Teste",
  "addressNumber": "123",
  "province": "Centro",
  "postalCode": "01310930",
  "webhooks": [
    {
      "name": "clube-teste-webhook",
      "url": "https://exemplo.invalido/webhooks/asaas/clube-teste",
      "email": "ops@example.com",
      "sendType": "SEQUENTIALLY",
      "enabled": true,
      "interrupted": false,
      "apiVersion": 3,
      "authToken": "SEGREDO_UNICO_POR_CLUBE_GERADO_PELA_PLATAFORMA",
      "events": ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]
    }
  ]
}
```

Resposta esperada (2xx): objeto com `id` (→ `externalAccountId`),
`walletId` (→ usado no split, ver Passo 3) e `apiKey` da sub-conta
(devolvida **uma única vez** — deve ser persistida cifrada
imediatamente, mesmo padrão de cuidado já aplicado à
`ABACATEPAY_API_KEY` em `redact.util.ts`).

### Passo 2 — checar status de onboarding

```http
GET /v3/myAccount/status/
access_token: {API_KEY_DA_SUBCONTA_DO_CLUBE}
```

Resposta esperada em Sandbox, quando a aprovação automática se aplica:
`general: "APPROVED"` (ou simular a aprovação manualmente pela própria
tela de Sandbox se cair em `AWAITING_APPROVAL`, conforme documentado em
"Detalhamento do Fluxo de Aprovação de Subcontas").

### Passo 3 — criar cobrança PIX com split para a sub-conta do clube

Executada com a **API key da conta principal (plataforma)**, não a do
clube — é a plataforma quem cria a cobrança em nome do jogador e
configura o split para a sub-conta do clube:

```http
POST /v3/payments
access_token: {API_KEY_DA_CONTA_PRINCIPAL}
Content-Type: application/json

{
  "customer": "{CUSTOMER_ID_DO_JOGADOR}",
  "billingType": "PIX",
  "value": 100.00,
  "dueDate": "2026-08-27",
  "description": "Buy-in torneio teste CL-RD-01",
  "split": [
    {
      "walletId": "{WALLET_ID_DA_SUBCONTA_DO_CLUBE}",
      "percentualValue": 95
    }
  ]
}
```

O valor não destinado ao `walletId` do split (aqui, 5%) fica retido na
conta principal — é a "taxa da casa"/da plataforma, sem transferência
manual posterior.

### Passo 4 — obter o QR Code / payload PIX

```http
GET /v3/payments/{PAYMENT_ID}/pixQrCode
access_token: {API_KEY_DA_CONTA_PRINCIPAL}
```

### Passo 5 — simular o pagamento (limitação conhecida)

A documentação oficial não expõe, até o momento desta pesquisa, um
endpoint de API para confirmar/simular o pagamento de uma cobrança PIX
em Sandbox — a confirmação é feita pelo botão **"Confirmar Pagamento"**
na própria interface web do Sandbox
(`docs.asaas.com/docs/testar-pagamento-de-qrcodes-pix`). Isso é uma
limitação real para automação 100% headless em CI: um teste de
integração completo (criar sub-conta → criar cobrança com split →
confirmar pagamento → validar webhook) não é executável só via
chamadas HTTP hoje — precisaria de um passo manual ou de automação de
UI (ex. Playwright contra o Sandbox), o que foge do padrão de CI comum
do backend Nest deste monorepo. Ficha registrada como risco a validar
antes de prometer testes e2e 100% automatizados dessa integração:
o caminho realista para CI é mockar a resposta do webhook
(`PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`) com um payload gravado
manualmente uma vez em Sandbox, em vez de depender do fluxo de
pagamento real a cada execução — o mesmo padrão que provavelmente já é
usado para os testes do webhook do AbacatePay hoje
(`abacatepay-webhook.controller.spec.ts`), a confirmar na
implementação.

## Consequências

- Nova dependência de integração (Asaas), ao lado do AbacatePay
  existente — dois PSPs em produção simultaneamente por tempo
  indeterminado (ver seção "AbacatePay em paralelo").
- Precisa de um `ClubePaymentAccountsModule`/client dedicado, seguindo o
  mesmo padrão de isolamento do `AbacatePayClient` (nenhum erro de
  transporte vaza cru, secrets nunca logados, retry só em falha
  idempotente) — não reinventar o padrão, reaproveitar a mesma
  arquitetura em `apps/backend/src/integrations/asaas/`.
- O model `ClubePaymentAccount` precisa, além dos 4 campos citados no
  ticket, de uma coluna para o `walletId` do Asaas (gap identificado no
  mapeamento acima) — a decidir o nome exato na tarefa de schema.
- O `WebhookEvent.provider` já comporta multi-provider sem migração;
  o novo controller de webhook (`webhooks/asaas`) precisa validar o
  `authToken` **por sub-conta/clube**, não um segredo global — diferente
  do `AbacatePayWebhookController` atual, que resolve tudo para uma
  conta só.
- Risco aceito: o combo "Sandbox 100% via API" não existe hoje para
  confirmação de pagamento PIX no Asaas — times de teste vão precisar de
  fixtures de webhook gravadas manualmente, não de um fluxo end-to-end
  automatizável contra o Sandbox real.
- Reavaliar esta decisão se o produto expandir para fora do Brasil (aí
  Stripe Connect volta a ser a opção mais forte) ou se o Asaas mudar sua
  política de aprovação automática de sub-contas de um jeito que
  invalide o critério 1.

## Fontes

- Asaas — Documentação oficial: `docs.asaas.com` (Introdução, Split de
  Pagamentos, Criação de subcontas, Criar subconta, Webhooks, Criar novo
  Webhook, Detalhamento do Fluxo de Aprovação de Subcontas, Consultar
  situação cadastral da conta, Transferências, Sandbox, Testar pagamento
  de QRCodes Pix), e `blog.asaas.com` (tarifário público de PIX/Split).
- Iugu — Documentação oficial: `dev.iugu.com` (Criar e Verificar
  Subconta, Criar, Verificar e Configurar Subconta, Split de Pagamentos,
  Tokens de Autenticação).
- Pagar.me — Documentação oficial: `docs.pagar.me` (Criando um
  Recebedor, Pix, API v5 — Adição do fluxo de Prova de Vida, Ambiente de
  teste para prova de vida).
- Stripe — Documentação oficial: `docs.stripe.com/connect` (Contas
  conectadas, Recursos e configurações da conta, Repasses para contas
  conectadas, Payment method available countries) e `stripe.com/global`.
- Código-fonte deste repositório:
  `apps/backend/src/integrations/abacatepay/*`,
  `apps/backend/src/wallet/abacatepay-webhook.controller.ts`,
  `apps/backend/prisma/schema/wallet.prisma`.
