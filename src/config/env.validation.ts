// src/config/env.validation.ts
import { z } from 'zod';

export const envSchema = z.object({
  TG_API_ID: z.string().min(1),
  TG_API_HASH: z.string().min(1),
  TG_SESSION_STRING: z.string().optional().default(''),
  RABBIT_URL: z.url(),
  RABBIT_EXCHANGE: z.string().min(1),
  RABBIT_SERVICE_QUEUE: z.string().min(1),
  RABBIT_PREFETCH: z.coerce.number().int().positive().default(25),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export type AppEnv = z.infer<typeof envSchema>;
