import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CryptoModule } from '../common/crypto/crypto.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { JWT_ALGORITHM, resolveJwtConfig, TokenService } from './token.service';

/**
 * Módulo de autenticação: emissão/verificação de tokens (`TokenService`),
 * endpoints (`AuthController`/`AuthService`) e os guards de autorização
 * (`JwtAuthGuard`, `RolesGuard`) usados pelos demais módulos do domínio.
 *
 * NOTA SOBRE O `JwtModule`: a factory NÃO define um `secret` global de
 * propósito. Access e refresh usam segredos distintos e o `TokenService`
 * escolhe o segredo explicitamente em cada `sign`/`verify`. Sem default
 * global, qualquer uso futuro do `JwtService` que "esqueça" de escolher o
 * segredo falha alto (`secretOrPrivateKey must have a value`) em vez de
 * assinar silenciosamente com o segredo errado.
 *
 * A factory ainda assim injeta o `ConfigService` para validar a configuração
 * de JWT no boot do módulo (`resolveJwtConfig`), mantendo o fail-fast mesmo
 * que o `TokenService` venha a ser resolvido de forma preguiçosa.
 */
@Module({
  imports: [
    // Importado explicitamente (mesmo com `ConfigModule.forRoot({ isGlobal:
    // true })` no AppModule) para que o módulo seja auto-suficiente em testes
    // e em qualquer composição futura.
    ConfigModule,
    PrismaModule,
    CryptoModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        resolveJwtConfig(configService);

        return {
          // Algoritmo fixado nas duas pontas: nenhum token pode negociar o
          // seu próprio algoritmo de verificação.
          signOptions: { algorithm: JWT_ALGORITHM },
          verifyOptions: { algorithms: [JWT_ALGORITHM] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [TokenService, AuthService, JwtAuthGuard, RolesGuard],
  exports: [TokenService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
