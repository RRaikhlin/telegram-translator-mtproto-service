// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { rmqMicroserviceOptions } from './rabbit/rabbit.config';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });
  const config = app.get(ConfigService);

  app.connectMicroservice(rmqMicroserviceOptions(config));
  await app.startAllMicroservices();
  // (Optional) If you also want an HTTP health port later, add app.listen
}
bootstrap();
