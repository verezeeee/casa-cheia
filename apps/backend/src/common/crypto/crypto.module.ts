import { Module } from '@nestjs/common';
import { HashService } from './hash.service';
import { PasswordHasherService } from './password-hasher.service';

/**
 * Agrupa os utilitários criptográficos puros da aplicação.
 *
 * Não é `@Global()` de propósito: cada módulo que precisar (auth, payments)
 * importa explicitamente o `CryptoModule`, deixando a dependência visível no
 * grafo de módulos.
 *
 * `timingSafeEqual` não é provider por ser uma função pura sem estado —
 * importe-a diretamente de `./timing-safe-equal`.
 */
@Module({
  providers: [PasswordHasherService, HashService],
  exports: [PasswordHasherService, HashService],
})
export class CryptoModule {}
