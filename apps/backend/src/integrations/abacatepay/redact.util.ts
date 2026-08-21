export const REDACTED = '[REDACTED]';

/** Profundidade máxima percorrida — protege contra payloads patológicos. */
const MAX_DEPTH = 5;
/** Corte de string: evita despejar um HTML de 500 KB de um proxy no log. */
const MAX_STRING_LENGTH = 512;
/** Corte de array: idem, mantém a linha de log legível. */
const MAX_ARRAY_ITEMS = 20;

/**
 * Chaves cujo VALOR nunca pode ser logado, independentemente de conter ou
 * não o segredo configurado: credenciais, tokens e a chave PIX do
 * beneficiário (dado pessoal — LGPD).
 */
const SENSITIVE_KEY_PATTERN =
  /(authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|token|secret|password|senha|cookie|pix[-_]?key|pixkey)/i;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

/**
 * Converte um objeto não-plano em string SEM cair no
 * `"[object Object]"`: usa o `toString` próprio da classe quando existe
 * (Error, AxiosError, Buffer...) e, na falta dele, a tag interna.
 */
const stringifyObject = (value: object): string => {
  const custom = (value as { toString?: () => unknown }).toString;

  if (typeof custom === 'function' && custom !== Object.prototype.toString) {
    const result: unknown = custom.call(value);
    if (typeof result === 'string') {
      return result;
    }
  }

  return Object.prototype.toString.call(value) as string;
};

const scrubString = (value: string, secrets: readonly string[]): string => {
  const scrubbed = secrets.reduce(
    (acc, secret) =>
      acc.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED),
    value,
  );

  return scrubbed.length > MAX_STRING_LENGTH
    ? `${scrubbed.slice(0, MAX_STRING_LENGTH)}…[truncado]`
    : scrubbed;
};

/**
 * Devolve uma cópia "segura de logar" de `value`:
 *
 * 1. toda ocorrência literal de qualquer `secret` (ex: a API key) vira
 *    `[REDACTED]`, inclusive quando embutida em uma string maior
 *    (`"Bearer abc123"` -> `"Bearer [REDACTED]"`);
 * 2. o valor de qualquer chave sensível é substituído por inteiro, mesmo
 *    que o segredo em questão não esteja na lista (defesa em profundidade
 *    contra credenciais que o gateway ecoe de volta);
 * 3. estruturas são truncadas em profundidade/tamanho.
 *
 * Usado tanto nas mensagens/propriedades das exceções de domínio quanto em
 * tudo que é passado ao `Logger` — é o único ponto onde essa garantia
 * precisa ser mantida.
 */
export function redactSecrets(
  value: unknown,
  secrets: readonly (string | undefined | null)[] = [],
  depth = 0,
): unknown {
  // Segredos vazios/curtos são ignorados: um `.replace('')` corromperia
  // toda string, e strings de 1-2 chars gerariam ruído inútil.
  const activeSecrets = secrets.filter(
    (secret): secret is string =>
      typeof secret === 'string' && secret.length >= 4,
  );

  const walk = (current: unknown, currentDepth: number): unknown => {
    if (current === null || current === undefined) {
      return current;
    }

    if (typeof current === 'string') {
      return scrubString(current, activeSecrets);
    }

    if (typeof current === 'number' || typeof current === 'boolean') {
      return current;
    }

    if (currentDepth >= MAX_DEPTH) {
      return '[Truncado]';
    }

    if (Array.isArray(current)) {
      const items = current
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => walk(item, currentDepth + 1));
      return current.length > MAX_ARRAY_ITEMS
        ? [...items, `…(+${current.length - MAX_ARRAY_ITEMS} itens)`]
        : items;
    }

    if (isPlainObject(current)) {
      return Object.entries(current).reduce<Record<string, unknown>>(
        (acc, [key, entryValue]) => {
          acc[key] = SENSITIVE_KEY_PATTERN.test(key)
            ? REDACTED
            : walk(entryValue, currentDepth + 1);
          return acc;
        },
        {},
      );
    }

    if (typeof current === 'function') {
      return '[Function]';
    }

    if (typeof current === 'bigint' || typeof current === 'symbol') {
      return scrubString(current.toString(), activeSecrets);
    }

    // Instâncias de classe (Error, Buffer, AxiosError...) não são
    // percorridas: serializá-las arrastaria `config.headers` junto.
    // Vira uma string curta e já higienizada.
    return scrubString(stringifyObject(current), activeSecrets);
  };

  return walk(value, depth);
}

/** Atalho para mensagens de erro/log, que são sempre `string`. */
export function redactString(
  value: string,
  secrets: readonly (string | undefined | null)[] = [],
): string {
  return redactSecrets(value, secrets) as string;
}
