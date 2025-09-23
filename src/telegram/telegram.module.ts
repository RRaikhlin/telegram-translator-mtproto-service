import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { EventsModule } from '../events/events.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule, EventsModule],
  providers: [TelegramService],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
