// src/rabbit/rabbit.config.ts
import { Transport, type RmqOptions } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';

export const rmqMicroserviceOptions = (config: ConfigService): RmqOptions => ({
  transport: Transport.RMQ,
  options: {
    urls: [config.getOrThrow<string>('RABBIT_URL')],
    // We’ll bind this queue to a topic exchange outside (compose or admin)
    queue: config.getOrThrow<string>('RABBIT_SERVICE_QUEUE'),
    queueOptions: {
      durable: true,
    },
    prefetchCount: config.get<number>('RABBIT_PREFETCH') ?? 25,
    persistent: true,
    noAck: false, // Nest acks automatically when the handler returns (success)
  },
});
