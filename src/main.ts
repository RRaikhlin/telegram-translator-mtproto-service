// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions } from '@nestjs/microservices';
import { rmqMicroserviceOptions } from './rabbit/rabbit.config';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    rmqMicroserviceOptions(process.env), // build options from env (no DI yet)
  );

  app.enableShutdownHooks(); // graceful stop for your TG client, RMQ, etc.
  await app.listen(); // starts DI, runs onModuleInit hooks, and connects to RMQ
}
bootstrap();
