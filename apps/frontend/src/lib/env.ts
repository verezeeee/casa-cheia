/**
 * Ponto único de leitura de variáveis de ambiente públicas do frontend.
 *
 * Nenhuma URL de API deve ser hardcoded em componentes/páginas - tudo passa
 * por aqui, lendo `NEXT_PUBLIC_API_URL`. Falha cedo (erro explícito) se a
 * variável não estiver definida, em vez de deixar `fetch` apontar para
 * "undefined/..." silenciosamente em runtime.
 */
// Lida sob demanda (não no top-level do módulo) para que páginas que nunca
// chamam a API não quebrem o build caso a env falte em algum ambiente
// estático; o erro aparece no momento real do uso do client HTTP.
export function getApiUrl(): string {
  const value = process.env.NEXT_PUBLIC_API_URL;

  if (!value) {
    throw new Error(
      'NEXT_PUBLIC_API_URL não está definida. Configure-a em apps/frontend/.env.local ' +
        '(veja .env.example na raiz do monorepo).',
    );
  }

  return value.replace(/\/+$/, '');
}
