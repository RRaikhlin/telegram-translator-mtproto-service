// src/telegram/dto/fetch-posts.dto.ts
import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class FetchPostsDto {
  @IsString()
  identifier!: string; // channel username or id

  @IsOptional()
  @IsInt()
  @Min(0)
  offsetId?: number; // last seen msg id

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number; // how many messages to fetch
}

export interface NormalizedMessage {
  id: number;
  date: string;
  message: string;
}
