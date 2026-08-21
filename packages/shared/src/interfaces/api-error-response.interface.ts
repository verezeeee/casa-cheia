/**
 * Formato padronizado de erro retornado pelo filtro global de exceções
 * do backend (ver apps/backend/src/common/filters/http-exception.filter.ts).
 */
export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
  timestamp: string;
  path: string;
}
