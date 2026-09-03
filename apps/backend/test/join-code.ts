/**
 * Gerador de `Clube.joinCode` para FIXTURES de teste.
 *
 * `joinCode` é `@unique` e NOT NULL desde a migration
 * `20260831055844_add_clube_join_code`, e nenhuma suíte cria clube pela API
 * (não há `POST /clubes` no caminho dos testes — ver ADR-0003): todas inserem
 * direto no banco e portanto precisam fornecer o código.
 *
 * Mesmo formato de `ClubService.generateJoinCode`: 6 dígitos, primeiro dígito
 * de 1 a 9 (sem zero à esquerda). Vive num módulo próprio, e não copiado em
 * cada spec, porque o formato tem que acompanhar o do service — uma cópia
 * esquecida geraria código inválido sem nenhum teste reclamar.
 */
export function randomJoinCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
