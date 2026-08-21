import {
  createHmac,
  randomBytes,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto';

/**
 * Chave HMAC efêmera, sorteada uma única vez por processo e nunca exposta.
 *
 * É o que torna a técnica de "double HMAC compare" segura: como o atacante
 * não conhece a chave, ele não consegue prever/controlar os digests
 * comparados e, portanto, não consegue extrair informação byte a byte a
 * partir do tempo de comparação.
 */
const COMPARISON_KEY = randomBytes(32);

/**
 * Digest HMAC-SHA256 (sempre 32 bytes) do valor recebido.
 */
function digestOf(value: string): Buffer {
  return createHmac('sha256', COMPARISON_KEY).update(value, 'utf8').digest();
}

/**
 * Comparação de strings resistente a timing attack.
 *
 * Por que não chamar `crypto.timingSafeEqual` direto nos buffers das strings:
 * o método nativo **lança** `RangeError` quando os buffers têm tamanhos
 * diferentes, o que obrigaria a um `if (a.length !== b.length) return false`
 * antes da comparação — um early-return que vaza o tamanho do segredo
 * (relevante ao validar assinatura HMAC de webhook).
 *
 * Solução (padrão "double HMAC", usado por Django/Rails): aplica-se HMAC-SHA256
 * com chave secreta efêmera sobre cada entrada. Os digests têm SEMPRE 32
 * bytes, então:
 *  - `crypto.timingSafeEqual` nunca lança, independentemente dos tamanhos
 *    originais;
 *  - a comparação percorre sempre os mesmos 32 bytes, em tempo constante;
 *  - digests iguais implicam entradas iguais (resistência a colisão do
 *    HMAC-SHA256).
 *
 * O `&&` com a comparação de tamanho vem DEPOIS da comparação em tempo
 * constante — é apenas um cinto de segurança lógico e não é usado como
 * atalho, portanto não introduz vazamento.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const equalDigests = nodeTimingSafeEqual(digestOf(a), digestOf(b));

  return equalDigests && a.length === b.length;
}
