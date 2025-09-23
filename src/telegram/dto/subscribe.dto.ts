// src/telegram/dto/subscribe.dto.ts
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class SubscribeDto {
  @IsString()
  identifier!: string; // @username OR t.me link OR numeric id

  @IsOptional()
  @IsBoolean()
  mute?: boolean;
}
