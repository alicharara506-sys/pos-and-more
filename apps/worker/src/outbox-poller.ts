import type { Queue } from 'bullmq';
import { prisma } from '@salesmaster/database';
import type { NotificationJobData } from './queues/notifications.queue';

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 8;

/**
 * Transactional-outbox drain: hands each unprocessed OutboxEvent row to
 * BullMQ (which owns retry/backoff from here on) and marks it processed.
 * Uses the outbox row's own id as the BullMQ jobId, so re-polling the same
 * row before the mark-processed write commits can never enqueue it twice —
 * duplicate delivery is a job the queue is designed to dedupe, not
 * something the poller needs to reason about.
 */
export async function pollOutboxOnce(queue: Queue<NotificationJobData>): Promise<number> {
  const events = await prisma.outboxEvent.findMany({
    where: { processedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });

  for (const event of events) {
    try {
      await queue.add(
        event.eventType,
        {
          outboxEventId: event.id,
          aggregateType: event.aggregateType,
          eventType: event.eventType,
          payload: event.payload as Record<string, unknown>,
        },
        { jobId: event.id, attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
      );
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 }, lastError: message },
      });
      console.error(
        `[outbox] failed to enqueue event ${event.id} (${event.eventType}): ${message}`,
      );
    }
  }

  return events.length;
}
