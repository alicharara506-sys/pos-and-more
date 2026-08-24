import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@salesmaster/database';

export interface PublishOutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

type PrismaTx = Prisma.TransactionClient;

/**
 * Transactional outbox: writes an OutboxEvent row in the same DB transaction
 * as the domain change it describes, so "sale created" can never be lost or
 * double-fired relative to the sale row itself. apps/worker polls/consumes
 * this table and is the ONLY place that calls slow/retryable external
 * providers (email, SMS, push, webhooks) — never inside a request-handling
 * transaction. See docs/architecture.md §Outbox.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(input: PublishOutboxEventInput, tx?: PrismaTx): Promise<void> {
    const client = tx ?? this.prisma.client;
    await client.outboxEvent.create({
      data: {
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }
}
