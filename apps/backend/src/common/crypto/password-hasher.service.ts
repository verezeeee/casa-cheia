import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Parâmetros de custo do argon2id.
 *
 * Baseados na "OWASP Password Storage Cheat Sheet" (configuração
 * `m=19456 (19 MiB), t=2, p=1`), que é o menor perfil ainda considerado
 * seguro pela OWASP para argon2id e o mais amigável a ambientes com pouca
 * RAM por processo (containers pequenos, funções serverless).
 *
 * - `memoryCost` (19456 KiB = 19 MiB): principal defesa contra cracking em
 *   GPU/ASIC — força o atacante a alocar memória por tentativa.
 * - `timeCost` (2 iterações): compensa o memoryCost relativamente baixo.
 * - `parallelism` (1 lane): mantém o custo previsível por request e evita
 *   competir com o event loop do Node em picos de login/registro.
 * - `hashLength` (32 bytes): saída de 256 bits.
 *
 * O salt é gerado aleatoriamente pelo próprio argon2 (16 bytes por padrão) e
 * fica embutido no encoded hash — por isso dois `hash()` da mesma senha
 * sempre produzem strings diferentes.
 */
export const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
};

/**
 * Serviço puro de hashing de senhas (argon2id).
 *
 * Não depende de Prisma nem de qualquer outro serviço: é totalmente
 * testável em unidade e reutilizável por qualquer módulo (auth, admin,
 * seeds) sem acoplamento a infraestrutura.
 */
@Injectable()
export class PasswordHasherService {
  /**
   * Gera o hash argon2id (encoded string, com salt e parâmetros embutidos)
   * de uma senha em claro.
   */
  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, ARGON2_OPTIONS);
  }

  /**
   * Verifica uma senha em claro contra um hash argon2 previamente gerado.
   *
   * Qualquer falha de parsing do hash (hash malformado, truncado, de outro
   * algoritmo ou vindo de dado corrompido no banco) é tratada como
   * "credencial inválida" e retorna `false`, em vez de propagar exceção e
   * virar um 500 — o chamador (auth) só precisa de um booleano.
   */
  async verify(plainPassword: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch {
      return false;
    }
  }
}
