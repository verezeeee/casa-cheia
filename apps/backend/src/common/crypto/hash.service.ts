import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * Serviço puro de hashing rápido e determinístico (SHA-256).
 *
 * Uso previsto: derivar o "lookup hash" de valores de alta entropia que não
 * podem ser persistidos em claro — principalmente refresh tokens. Como o
 * token já é aleatório e longo, não há necessidade (nem espaço para) um KDF
 * lento como argon2 aqui: SHA-256 é suficiente e permite indexar/buscar a
 * linha da sessão.
 *
 * ATENÇÃO: nunca usar este serviço para senhas de usuário — para isso existe
 * o `PasswordHasherService` (argon2id, com salt).
 */
@Injectable()
export class HashService {
  /**
   * Retorna o SHA-256 do valor, em hexadecimal minúsculo (64 caracteres).
   */
  sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
