// src/telegram/app/telegram-app.service.ts
// Purpose: Application/business layer for Telegram flows.
// - Orchestrates use-cases: subscribe, fetch posts, background handling of new messages
// - Normalizes GramJS results to app DTOs
// - Ensures idempotency (no duplicate processing) and emits domain events

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Api } from 'telegram';
import { NewMessageEvent } from 'telegram/events';
import { TelegramClientService } from '../infra/telegram-client.service';
// NOTE: use a relative path unless your tsconfig "paths" alias @/… is configured
import { EventsPublisher } from '../../events/events.publisher';
import { FetchPostsDto, NormalizedMessage } from '../dto/fetch-posts.dto';
import {
  SubscribeRpcResponse,
  UnsubscribeRpcResponse,
} from '../../shared/types/types-to-synchronize';

// ---- Idempotency store (sync, in-memory for dev) -----------------------------

export interface ProcessedMessagesRepo {
  wasProcessed(key: string): boolean;
  markProcessed(key: string): void;
}

class InMemoryProcessedMessagesRepo
  implements ProcessedMessagesRepo, OnModuleDestroy
{
  private readonly seen = new Set<string>();
  wasProcessed(key: string): boolean {
    return this.seen.has(key);
  }
  markProcessed(key: string): void {
    this.seen.add(key);
  }
  onModuleDestroy(): void {
    this.seen.clear();
  }
}

// ---- Helpers ----------------------------------------------------------------

function toIsoFromTelegramDate(d: number | Date | undefined): string {
  if (typeof d === 'number') return new Date(d * 1000).toISOString(); // unix sec -> ms
  if (d instanceof Date) return d.toISOString();
  return new Date(0).toISOString();
}

type NewPostEventPayload = {
  channelId: string;
  messageId: number;
  text: string;
  date: string; // ISO
};

// ---- Service ----------------------------------------------------------------

@Injectable()
export class TelegramAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramAppService.name);

  private boundNewMessageHandler?: (e: NewMessageEvent) => void;

  // swap with a real (DB/Redis) repo via DI later
  private readonly processedRepo: ProcessedMessagesRepo =
    new InMemoryProcessedMessagesRepo();

  constructor(
    private readonly tgClient: TelegramClientService, // infra MTProto client
    private readonly events: EventsPublisher, // RabbitMQ event publisher
  ) {}

  // Lifecycle: subscribe/unsubscribe to the infra stream
  onModuleInit(): void {
    this.boundNewMessageHandler = (ev: NewMessageEvent) => {
      try {
        this.handleNewMessage(ev);
      } catch (err) {
        this.logger.error(
          'NewMessage handler crashed',
          (err as Error)?.stack ?? String(err),
        );
      }
    };
    this.tgClient.addNewMessageListener(this.boundNewMessageHandler);
    this.logger.log('TelegramAppService subscribed to Infra NewMessage stream');
  }

  onModuleDestroy(): void {
    if (this.boundNewMessageHandler) {
      this.tgClient.removeNewMessageListener(this.boundNewMessageHandler);
    }
  }

  // Normalize + idempotency + publish event
  private handleNewMessage(ev: NewMessageEvent): void {
    const msg = ev.message;

    // Derive a stable "channel-like" id from peer union
    const peer = msg.peerId; // Api.PeerChannel | Api.PeerChat | Api.PeerUser | undefined
    let channelId = 'unknown';

    if (peer && 'channelId' in peer && peer.channelId != null) {
      channelId = String(peer.channelId);
    } else if (peer && 'chatId' in peer && peer.chatId != null) {
      channelId = `chat:${String(peer.chatId)}`;
    } else if (peer && 'userId' in peer && peer.userId != null) {
      channelId = `user:${String(peer.userId)}`;
    }

    const messageId = msg.id ?? -1;
    const text = msg.message ?? '';
    const date = toIsoFromTelegramDate(msg.date);

    const key = `${channelId}:${messageId}`;
    if (this.processedRepo.wasProcessed(key)) {
      this.logger.debug(`Skip duplicate message ${key}`);
      return;
    }

    const payload: NewPostEventPayload = { channelId, messageId, text, date };
    this.logger.log(`Publishing telegram.post.created for ${key}`);
    this.events.emitNewPost(payload); // fire-and-forget
    this.processedRepo.markProcessed(key);

    this.logger.debug(`Published telegram.post.created for ${key}`);
  }

  // ---- Public use-cases (called by RPC controller) --------------------------

  /**
   * Subscribe to a channel by identifier (username, t.me link, or numeric id).
   * Thin orchestration: delegate to the infra client; add business checks here if needed.
   */
  async subscribeToChannel(identifier: string): Promise<SubscribeRpcResponse> {
    const info = await this.tgClient.joinAndResolve(identifier);
    // (Optional) persist subscription, emit another business event, etc.
    return { ok: true as const, channel: info };
  }
  async unsubscribeToChannel(
    identifier: string,
  ): Promise<UnsubscribeRpcResponse> {
    const info = await this.tgClient.leave(identifier);
    return { left: info.left, kind: info.kind };
  }

  /**
   * Fetch a page of messages and normalize into a stable DTO.
   * Note: this does NOT publish events (by design). Eventing happens in the background
   * via NewMessage stream to keep "fetch" idempotent and fast.
   */
  async fetchHistory(
    dto: FetchPostsDto,
  ): Promise<{ list: NormalizedMessage[]; nextOffsetId?: number }> {
    const { identifier } = dto;
    const limit = dto.limit ?? 20;
    const offsetId = dto.offsetId ?? 0;

    const raw = await this.tgClient.getHistory({
      identifier,
      limit,
      offsetId,
    });

    // raw is Api.messages.Messages | Api.messages.MessagesSlice
    const items = raw.messages ?? [];

    // Filter: we only keep concrete messages; skip service messages
    const real = items.filter(
      (m): m is Api.Message => m instanceof Api.Message,
    );

    const list: NormalizedMessage[] = real.map((m) => ({
      id: m.id,
      date: toIsoFromTelegramDate(m.date),
      message: m.message ?? '',
    }));

    const nextOffsetId = list.length ? list[list.length - 1].id : undefined;
    return { list, nextOffsetId };
  }

  /**
   * Health proxy — checks MTProto connectivity via infra client.
   */
  async health(): Promise<{ status: 'ok' | 'down' }> {
    const status = await this.tgClient.health();
    return { status };
  }
}
