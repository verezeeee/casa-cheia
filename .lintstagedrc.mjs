// Config de lint-staged (pre-commit).
//
// Cada app/pacote do monorepo tem sua própria versão/config de ESLint
// (ESLint 9 flat config). Para garantir que o binário e o eslint.config.mjs
// corretos sejam usados, delegamos via `pnpm --filter <dir> exec eslint`
// em vez de chamar um `eslint` genérico a partir da raiz.
const quote = (files) => files.map((f) => JSON.stringify(f)).join(' ');

export default {
  'apps/backend/**/*.{ts,js}': (files) =>
    `pnpm --filter ./apps/backend exec eslint --fix ${quote(files)}`,
  'apps/frontend/**/*.{ts,tsx,js,jsx}': (files) =>
    `pnpm --filter ./apps/frontend exec eslint --fix ${quote(files)}`,
  'packages/shared/**/*.ts': (files) =>
    `pnpm --filter ./packages/shared exec eslint --fix ${quote(files)}`,
  '**/*.{ts,tsx,js,jsx,json,md,yml,yaml,css}': (files) => `prettier --write ${quote(files)}`,
};
