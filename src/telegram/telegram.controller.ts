// src/telegram/telegram.controller.ts
import { Api } from 'telegram';
import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TelegramService } from './telegram.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { FetchPostsDto, NormalizedMessage } from './dto/fetch-posts.dto';

function toIsoFromTelegramDate(d: number | Date | undefined): string {
  if (typeof d === 'number') return new Date(d * 1000).toISOString(); // unix seconds -> ms
  if (d instanceof Date) return d.toISOString();
  return new Date(0).toISOString(); // fallback (epoch) or use new Date().toISOString()
}

@Controller()
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);
  constructor(private readonly tg: TelegramService) {}

  @MessagePattern('telegram.subscribe')
  async subscribe(@Payload() dto: SubscribeDto) {
    const client = this.tg.getClient();
    const entity = await client.getEntity(dto.identifier);
    await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
    this.logger.log(`Subscribed to ${dto.identifier}`);
    return { ok: true };
  }

  @MessagePattern('telegram.fetchPosts')
  async fetchPosts(@Payload() dto: FetchPostsDto) {
    const client = this.tg.getClient();
    const entity = await client.getEntity(dto.identifier);

    const limit = dto.limit ?? 20;
    const offsetId = dto.offsetId ?? 0;

    const history = await client.invoke(
      new Api.messages.GetHistory({
        peer: entity,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        offsetDate: 0,
        offsetId,
      }),
    );

    // history can be Messages or MessagesSlice; both have `.messages`
    const items = (history as Api.messages.Messages).messages ?? [];

    // 2) normalize to a stable shape
    const realMessages = items.filter(
      (m): m is Api.Message => m instanceof Api.Message,
    );

    // 2) normalize to a stable shape
    const msgs: NormalizedMessage[] = realMessages.map((m) => ({
      id: m.id,
      date: toIsoFromTelegramDate(m.date), // <-- no casts, no instanceof on number
      message: m.message ?? '',
    }));

    return { list: msgs };
  }

  @MessagePattern('telegram.health')
  async health() {
    try {
      await this.tg.getClient().getMe();
      return { status: 'ok' };
    } catch {
      return { status: 'down' };
    }
  }
}
