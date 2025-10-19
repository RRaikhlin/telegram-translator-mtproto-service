// src/telegram/infra/telegram-client.service.ts
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Entity } from 'telegram/define';
import { safeClassName } from './helper';
import { RPCError } from 'telegram/errors';
import { UnsubscribeRpcResponse } from '../../shared/types/types-to-synchronize';

/**
 * Purpose: Infrastructure-only wrapper around GramJS.
 * - Owns the single TelegramClient instance and connection lifecycle
 * - Exposes small I/O methods (join channel, fetch history, getMe/health)
 * - Exposes a safe API to subscribe to NewMessage events
 *
 * NO business decisions or persistence here. Keep controllers and app services
 * on top of this layer.
 */
@Injectable()
export class TelegramClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramClientService.name);

  private client!: TelegramClient;
  private session!: StringSession;

  // We keep track of (handler, filter) pairs so we can remove them cleanly.
  private readonly newMessageHandlers = new Map<
    (e: NewMessageEvent) => void,
    NewMessage
  >();

  constructor(private readonly config: ConfigService) {}

  /** DEV-ONLY helper for first-time interactive login on your machine (Windows Terminal). */
  private async ask(question: string) {
    const rl = readline.createInterface({ input, output });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  }

  /**
   * Boot the MTProto client once.
   * - If TG_SESSION_STRING is empty => run interactive login & print a session string.
   * - Else => connect immediately.
   */
  async onModuleInit(): Promise<void> {
    console.log('Loading Telegram MTProto client...');
    const apiId = Number(this.config.getOrThrow('TG_API_ID'));
    const apiHash = this.config.getOrThrow<string>('TG_API_HASH');
    const saved = this.config.get<string>('TG_SESSION_STRING') ?? '';

    this.session = new StringSession(saved);
    this.client = new TelegramClient(this.session, apiId, apiHash, {
      connectionRetries: 5,
    });

    if (!saved) {
      this.logger.warn(
        'No TG_SESSION_STRING found. Starting interactive login (dev-only)…',
      );

      await this.client.start({
        phoneNumber: async () => await this.ask('Phone number: '),
        phoneCode: async () => await this.ask('Code from Telegram: '),
        password: async () => await this.ask('2FA password (if any): '),
        onError: (err) => this.logger.error(err),
      });

      const ss = this.session.save();
      this.logger.warn(
        [
          '=== COPY YOUR SESSION STRING BELOW ===',
          ss,
          '=== Put it into TG_SESSION_STRING env var for next runs ===',
        ].join('\n'),
      );
    } else {
      await this.client.connect();
      this.logger.log('Telegram MTProto connected with saved session.');
      console.log('Connected to Telegram MTProto');
    }
  }

  /** Gracefully disconnect on shutdown. */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.client?.disconnect();
    } catch {
      /* ignore */
    }
  }

  // ───────────────────────────────────────
  // Public INFRA methods (no business rules)
  // ───────────────────────────────────────

  /**
   * Join a public channel / resolve peer and invoke JoinChannel.
   * @param identifier username ('@channelName') or t.me link or numeric id
   */
  async joinAndResolve(identifier: string): Promise<{
    tgId: string;
    username?: string;
    title?: string;
  }> {
    const entity: Entity = await this.client.getEntity(identifier);

    if (entity instanceof Api.Channel) {
      await this.client.invoke(
        new Api.channels.JoinChannel({ channel: entity }),
      );
      this.logger.log(`Joined channel: ${identifier}`);
      return {
        tgId: String(entity.id),
        username: entity.username ?? undefined,
        title: entity.title,
      };
    }
    if (entity instanceof Api.Chat) {
      return {
        tgId: `chat:${String(entity.id)}`,
        title: entity.title ?? undefined,
      };
    }
    if (entity instanceof Api.User) {
      return {
        tgId: `user:${String(entity.id)}`,
        username: entity.username ?? undefined,
        title:
          [entity.firstName, entity.lastName].filter(Boolean).join(' ') ||
          undefined,
      };
    }
    if (entity instanceof Api.ChannelForbidden) {
      return {
        tgId: String(entity.id),
        title: entity.title ?? undefined,
      };
    }

    throw new Error(`Unsupported peer type: ${safeClassName(entity)}`);
  }

  async leave(identifier: string): Promise<UnsubscribeRpcResponse> {
    const entity = await this.client.getEntity(identifier);

    try {
      if (
        entity instanceof Api.Channel ||
        entity instanceof Api.ChannelForbidden
      ) {
        // Works for broadcast channels and supergroups alike
        await this.client.invoke(
          new Api.channels.LeaveChannel({ channel: entity }),
        );
        this.logger.log(`Left channel/supergroup: ${identifier}`);
        const kind: 'megagroup' | 'channel' =
          entity instanceof Api.Channel && entity.megagroup
            ? 'megagroup'
            : 'channel';

        return { left: true, kind };
      }

      if (entity instanceof Api.Chat) {
        // Legacy small group chats
        await this.client.invoke(
          new Api.messages.DeleteChatUser({
            chatId: entity.id,
            userId: 'me', // remove myself
          }),
        );
        this.logger.log(`Left legacy chat: ${identifier}`);
        return { left: true, kind: 'chat' };
      }

      if (entity instanceof Api.User) {
        // 1:1 dialog — no "unsubscribe". We can delete dialog history (and optionally block)
        await this.client.invoke(
          new Api.messages.DeleteHistory({
            peer: entity,
            maxId: 0, // all messages
            revoke: false, // don't delete for the other side
          }),
        );
        // Optionally, to stop bot messages: await this.client.invoke(new Api.contacts.Block({ id: entity }));
        this.logger.log(`Deleted dialog with user: ${identifier}`);
        return { left: true, kind: 'user' };
      }

      throw new Error(`Unsupported peer type: ${safeClassName(entity)}`);
    } catch (err) {
      // Make "leave" idempotent: many RPC errors just mean we're already out
      if (err instanceof RPCError) {
        const code = err.errorMessage ?? '';
        // Common cases you might see when you're not a participant anymore
        if (
          code.includes('USER_NOT_PARTICIPANT') ||
          code.includes('CHANNEL_PRIVATE') ||
          code.includes('CHAT_ID_INVALID') ||
          code.includes('CHANNEL_INVALID') ||
          code.includes('PEER_ID_INVALID')
        ) {
          this.logger.warn(`Treating as already left: ${identifier} (${code})`);
          return {
            left: true,
            kind:
              entity instanceof Api.Chat
                ? 'chat'
                : entity instanceof Api.User
                  ? 'user'
                  : 'channel',
          };
        }
      }
      this.logger.error(`Failed to leave ${identifier}:`, err as Error);
      throw err;
    }
  }

  /**
   * Fetch message history from a peer.
   * You get the raw GramJS response (Messages or MessagesSlice).
   * Business-layer should normalize/filter and compute offsets.
   */
  async getHistory(params: {
    identifier: string;
    limit?: number;
    offsetId?: number;
    addOffset?: number;
    maxId?: number;
    minId?: number;
    offsetDate?: number;
  }): Promise<Api.messages.Messages> {
    const {
      identifier,
      limit = 20,
      offsetId = 0,
      addOffset = 0,
      maxId = 0,
      minId = 0,
      offsetDate = 0,
    } = params;

    const entity = await this.client.getEntity(identifier);

    const res = await this.client.invoke(
      new Api.messages.GetHistory({
        peer: entity,
        limit,
        offsetId,
        addOffset,
        maxId,
        minId,
        offsetDate,
      }),
    );

    // Cast for TS convenience; caller should treat like union (Messages/MessagesSlice)
    return res as Api.messages.Messages;
  }

  /** Lightweight identity call — useful for health checks. */
  async getMe(): Promise<Api.User | Api.UserEmpty> {
    return this.client.getMe();
  }

  /** Returns 'ok' if getMe() succeeds, otherwise 'down'. */
  async health(): Promise<'ok' | 'down'> {
    try {
      await this.getMe();
      return 'ok';
    } catch {
      return 'down';
    }
  }

  // ───────────────────────────────────────
  // NewMessage event subscription API
  // ───────────────────────────────────────

  /**
   * Subscribe to NewMessage events.
   * We keep your handler and the GramJS filter object so you can later remove it.
   *
   * NOTE: This is infra-level: we forward the raw NewMessageEvent.
   * Your application service should normalize/route/publish domain events.
   */
  addNewMessageListener(handler: (e: NewMessageEvent) => void): void {
    // You can pass filters to NewMessage({}) if needed (e.g., only chats/channels).
    const filter = new NewMessage({});
    this.client.addEventHandler(handler, filter);
    this.newMessageHandlers.set(handler, filter);
    this.logger.log('Registered NewMessage listener');
  }

  /**
   * Unsubscribe a previously registered NewMessage handler.
   */
  removeNewMessageListener(handler: (e: NewMessageEvent) => void): void {
    const filter = this.newMessageHandlers.get(handler);
    if (!filter) return;

    // GramJS doesn't expose a direct "remove" API, but you can no-op the handler
    // or keep your own guard. For clarity, we just delete our reference.
    // If you need strict removal, track a boolean flag in your handler and ignore events.
    this.newMessageHandlers.delete(handler);
    this.logger.log('Removed NewMessage listener (logical)');
  }

  // ───────────────────────────────────────
  // Optional: expose low-level client if you really need it (try not to)
  // ───────────────────────────────────────
  getRawClient(): TelegramClient {
    return this.client;
  }
}
