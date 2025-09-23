// src/telegram/telegram.service.ts
// Purpose: Long-lived MTProto client. On startup, it connects, listens for new posts,
// and publishes them to RabbitMQ through EventsPublisher.
// Technology: NestJS provider + GramJS (TelegramClient) + Node readline/promises.
// How: one singleton service; onModuleInit() boots the client; NewMessage handler emits events.

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { EventsPublisher } from '../events/events.publisher';

// keep your normalized shape consistent across fetch & events
type NormalizedEvent = {
  channelId: string;
  messageId: number;
  text: string;
  date: string; // ISO string
};

// helper: unix seconds OR Date -> ISO string
function toIsoFromTelegramDate(d: number | Date | undefined): string {
  if (typeof d === 'number') return new Date(d * 1000).toISOString();
  if (d instanceof Date) return d.toISOString();
  return new Date(0).toISOString();
}

@Injectable()
export class TelegramService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private client!: TelegramClient;
  private session!: StringSession;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventsPublisher,
  ) {}

  /** Ask user input in Windows Terminal (dev-only first login) */
  private async ask(question: string) {
    const rl = readline.createInterface({ input, output });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  }

  private handleNewMessage(event: NewMessageEvent): void {
    const msg = event.message;
    if (!msg) return;

    const peerId = msg.peerId as
      | Api.PeerChannel
      | Api.PeerChat
      | Api.PeerUser
      | undefined;

    const channelId: string =
      peerId && 'channelId' in peerId
        ? peerId.channelId.toString()
        : peerId && 'chatId' in peerId
          ? `chat:${peerId.chatId.toString()}`
          : peerId && 'userId' in peerId
            ? `user:${peerId.userId.toString()}`
            : 'unknown';

    const payload: NormalizedEvent = {
      channelId,
      messageId: msg.id ?? -1,
      text: msg.message ?? '',
      date: toIsoFromTelegramDate(msg.date),
    };

    this.logger.debug(`NewMessage -> ${JSON.stringify(payload)}`);
    this.events.emitNewPost(payload);
  }

  /** Boot MTProto client once and subscribe to updates */
  async onModuleInit() {
    const apiId = Number(this.config.getOrThrow('TG_API_ID'));
    const apiHash = this.config.getOrThrow<string>('TG_API_HASH');
    const saved = this.config.get<string>('TG_SESSION_STRING') ?? '';

    this.session = new StringSession(saved);
    this.client = new TelegramClient(this.session, apiId, apiHash, {
      connectionRetries: 5,
    });

    if (!saved) {
      // First run: interactive login (dev machine)
      this.logger.warn('No session string found. Starting interactive login…');
      await this.client.start({
        phoneNumber: async () => await this.ask('Phone number: '),
        phoneCode: async () => await this.ask('Code: '),
        password: async () => await this.ask('2FA password (if any): '),
        onError: (err) => this.logger.error(err),
      });

      const ss = this.session.save(); // concrete StringSession => string
      this.logger.warn(
        `COPY THIS SESSION STRING and put into TG_SESSION_STRING:\n${ss}`,
      );
    } else {
      await this.client.connect();
      this.logger.log('Telegram client connected with saved session.');
    }

    // Subscribe to new messages (incl. channel posts) and publish to Rabbit
    this.client.addEventHandler((event) => {
      try {
        this.handleNewMessage(event);
      } catch (err) {
        this.logger.error('NewMessage handler failed', err);
      }
    }, new NewMessage({}));
  }

  /** Expose the client to controllers (RPC handlers) */
  getClient() {
    return this.client;
  }

  async onModuleDestroy() {
    try {
      await this.client?.disconnect();
    } catch {
      // ignore
    }
  }
}
