import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Módulo global: o PrismaService é injetável em qualquer módulo da
 * aplicação sem precisar reimportar `PrismaModule` em cada um deles.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
