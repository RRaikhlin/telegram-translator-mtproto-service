// src/events/events.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventsPublisher } from './events.publisher';

@Module({
  imports: [ConfigModule],
  providers: [EventsPublisher],
  exports: [EventsPublisher],
})
export class EventsModule {}
