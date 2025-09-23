// src/telegram/telegram.module.ts
import { Module } from '@nestjs/common';
import { TelegramAppService } from './app/telegram-app.service';
import { TelegramController } from './telegram.controller';
import { EventsModule } from '../events/events.module';
import { ConfigModule } from '@nestjs/config';
import { TelegramClientService } from './infra/telegram-client.service';

@Module({
  imports: [ConfigModule, EventsModule],
  providers: [TelegramClientService, TelegramAppService],
  controllers: [TelegramController],
  exports: [TelegramAppService],
})
export class TelegramModule {}
