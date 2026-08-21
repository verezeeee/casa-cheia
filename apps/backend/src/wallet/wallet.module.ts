import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AbacatePayModule } from '../integrations/abacatepay';
import { PrismaModule } from '../prisma/prisma.module';
import { AbacatePayWebhookController } from './abacatepay-webhook.controller';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [PrismaModule, AbacatePayModule, AuthModule],
  controllers: [WalletController, AbacatePayWebhookController],
  providers: [WalletService],
})
export class WalletModule {}
