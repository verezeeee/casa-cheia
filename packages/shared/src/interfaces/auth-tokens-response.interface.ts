/**
 * Resposta de autenticação (login / refresh).
 *
 * SEGURANÇA: o refresh token NUNCA aparece neste corpo. Ele é entregue
 * exclusivamente em cookie `httpOnly` + `Secure` + `SameSite`, de modo que
 * JavaScript da página (e, portanto, um XSS) não consiga lê-lo. Apenas o
 * access token — de vida curta — fica acessível à aplicação, mantido em
 * memória e enviado via header `Authorization: Bearer`.
 */
export interface AuthTokensResponse {
  /** JWT de acesso, de vida curta. */
  accessToken: string;

  /** Tempo de vida do `accessToken` em SEGUNDOS (não é um timestamp). */
  expiresIn: number;
}
