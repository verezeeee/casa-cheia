# ADRs — Architecture Decision Records

Um ADR registra uma decisão de arquitetura **já tomada**: o contexto que existia, a decisão em si e as consequências aceitas junto com ela. Serve para responder "por que isso é assim?" seis meses depois, sem reabrir a discussão do zero.

ADR não é proposta nem RFC — quando o documento é escrito, a decisão já está fechada. Mudar de ideia significa escrever um ADR novo que substitui o anterior (o antigo vira `Status: Substituído por NNNN`), nunca editar o histórico.

Convenção de nome: `NNNN-titulo-kebab-case.md`, com `NNNN` sequencial e zero-padded a partir de `0001` (ex.: `0001-multi-tenant-clube.md`). O número nunca é reutilizado, mesmo que o ADR seja descartado.
