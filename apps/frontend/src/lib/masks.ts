/**
 * Máscaras de entrada (pt-BR) para documentos e telefone.
 *
 * Puramente de EXIBIÇÃO: o valor "canônico" que os formulários guardam no
 * `useState` e mandam pra API continua sendo só dígitos (contrato de
 * `RegisterRequest.document`, `CreateClubeRequest.document` e
 * `SitGuestAtTableRequest.phone` — ver `lib/api/types.ts`). Cada `mask*`
 * recebe esse valor cru e devolve a versão pontuada/parenizada para o
 * `value` do `<input>`; o `onChange` continua extraindo dígitos com
 * `onlyDigits` antes de guardar no estado.
 */

/** Descarta tudo que não é dígito e trunca aos primeiros `max`. */
export function onlyDigits(value: string, max?: number): string {
  const digits = value.replace(/\D/g, '');
  return max === undefined ? digits : digits.slice(0, max);
}

/** Intercala dígitos num `pattern` onde `#` marca a posição de um dígito. */
function applyMask(digits: string, pattern: string): string {
  let result = '';
  let digitIndex = 0;

  for (let i = 0; i < pattern.length && digitIndex < digits.length; i++) {
    if (pattern[i] === '#') {
      result += digits[digitIndex];
      digitIndex++;
    } else {
      result += pattern[i];
    }
  }

  return result;
}

/**
 * CPF: 000.000.000-00.
 *
 * @example maskCpf('12345678901') // "123.456.789-01"
 */
export function maskCpf(value: string): string {
  return applyMask(onlyDigits(value, 11), '###.###.###-##');
}

/**
 * CNPJ: 00.000.000/0000-00.
 *
 * @example maskCnpj('12345678000199') // "12.345.678/0001-99"
 */
export function maskCnpj(value: string): string {
  return applyMask(onlyDigits(value, 14), '##.###.###/####-##');
}

/**
 * CPF ou CNPJ no mesmo campo (ex.: documento do clube, que aceita os dois —
 * ver `create-clube-dialog.tsx`/`register/page.tsx`). Decide o formato pela
 * quantidade de dígitos já digitados: até 11 usa a máscara de CPF, a partir
 * do 12º dígito passa a formatar como CNPJ.
 *
 * @example maskCpfOuCnpj('12345678901')     // "123.456.789-01"
 * @example maskCpfOuCnpj('12345678000199')  // "12.345.678/0001-99"
 */
export function maskCpfOuCnpj(value: string): string {
  const digits = onlyDigits(value, 14);
  return digits.length > 11 ? maskCnpj(digits) : maskCpf(digits);
}

/**
 * Telefone brasileiro (DDD + número): `(00) 00000-0000` para celular (9
 * dígitos após o DDD) ou `(00) 0000-0000` para fixo (8 dígitos) — decide pelo
 * total de dígitos já digitados.
 *
 * @example maskPhone('11988887777') // "(11) 98888-7777"
 * @example maskPhone('1133334444')  // "(11) 3333-4444"
 */
export function maskPhone(value: string): string {
  const digits = onlyDigits(value, 11);
  return applyMask(digits, digits.length > 10 ? '(##) #####-####' : '(##) ####-####');
}
