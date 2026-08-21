/**
 * Concatenador mínimo de classes CSS.
 *
 * Evita adicionar dependências (clsx/tailwind-merge) nesta fase: os
 * componentes de UI expõem `className` como último item da composição, de
 * modo que a classe vinda de fora sempre aparece depois das internas.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
