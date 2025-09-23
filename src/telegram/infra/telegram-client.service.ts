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
  async joinChannel(identifier: string): Promise<void> {
    const entity = await this.client.getEntity(identifier);
    await this.client.invoke(new Api.channels.JoinChannel({ channel: entity }));
    this.logger.log(`Joined channel: ${identifier}`);
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
