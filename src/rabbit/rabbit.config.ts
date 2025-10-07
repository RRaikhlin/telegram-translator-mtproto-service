// src/rabbit/rabbit.config.ts
import { RmqOptions, Transport } from '@nestjs/microservices';

export function rmqMicroserviceOptions(env: NodeJS.ProcessEnv): RmqOptions {
  const url = env.RABBIT_URL!;
  const queue = env.RABBIT_SERVICE_QUEUE ?? 'telegram';
  return {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      queue,
      queueOptions: { durable: true },
      prefetchCount: 25,
    },
  };
}
