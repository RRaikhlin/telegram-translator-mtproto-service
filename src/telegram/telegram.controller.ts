// src/telegram/telegram.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TelegramAppService } from './app/telegram-app.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { FetchPostsDto } from './dto/fetch-posts.dto';

@Controller()
export class TelegramController {
  constructor(private readonly app: TelegramAppService) {}

  @MessagePattern('telegram.subscribe')
  subscribe(@Payload() dto: SubscribeDto) {
    return this.app.subscribeToChannel(dto.identifier);
  }

  @MessagePattern('telegram.unsubscribe')
  unsubscribe(@Payload() identifier: string) {
    return this.app.unsubscribeToChannel(identifier);
  }

  @MessagePattern('telegram.fetchPosts')
  fetchPosts(@Payload() dto: FetchPostsDto) {
    return this.app.fetchHistory(dto);
  }

  @MessagePattern('telegram.health')
  async health() {
    return this.app.health(); // returns {status:'ok'|'down'}
  }
}
