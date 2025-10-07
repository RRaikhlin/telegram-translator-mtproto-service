// src/events/events.publisher.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
  ClientOptions, // <— important
} from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EventsPublisher {
  private readonly logger = new Logger(EventsPublisher.name);
  private client: ClientProxy;

  constructor(private readonly config: ConfigService) {
    const options: ClientOptions = {
      transport: Transport.RMQ,
      options: {
        urls: [this.config.getOrThrow<string>('RABBIT_URL')],
        queue: 'mtproto.queS',
        queueOptions: { durable: true },
        prefetchCount: this.config.get<number>('RABBIT_PREFETCH') ?? 25,
        persistent: true,
      },
    };

    this.client = ClientProxyFactory.create(options);
  }

  // fire-and-forget event
  emitNewPost(payload: unknown): void {
    // a pattern name works like a routing key in Nest RMQ
    this.client.emit('telegram.post.created', payload);
    // no await needed; emit returns Observable<void> for fire-and-forget
  }
}
