import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';

export const NOTIFICATIONS_QUEUE_NAME = 'notifications';

export interface NotificationJobData {
  outboxEventId: string;
  aggregateType: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export function createNotificationsQueue(connection: IORedis): Queue<NotificationJobData> {
  return new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, { connection });
}

/**
 * Handles the actual side-effect for each outbox event type. This is
 * deliberately the ONLY place in the system that would call a real
 * notification provider — never inside a request-handling DB transaction
 * (spec §16). Right now no live email/SMS provider is configured (see
 * docs/integrations.md), so this logs what it *would* send rather than
 * claiming a delivery that didn't happen — never fabricate a success.
 */
async function handleNotification(job: Job<NotificationJobData>): Promise<void> {
  const { eventType, payload } = job.data;

  switch (eventType) {
    case 'tenant.created':
      console.log(
        `[notifications] would send welcome email to ${payload.ownerEmail} for tenant ${payload.tenantId}`,
      );
      break;
    case 'invitation.created':
      console.log(
        `[notifications] would send invitation email to ${payload.email} (tenant ${payload.tenantId})`,
      );
      break;
    case 'sale.created':
      console.log(`[notifications] sale ${payload.saleId} recorded for tenant ${payload.tenantId}`);
      break;
    case 'sale.refunded':
      console.log(
        `[notifications] refund of ${payload.amount} recorded for sale ${payload.saleId}`,
      );
      break;
    case 'invoice.issued':
      console.log(`[notifications] would email invoice ${payload.invoiceId} to the customer`);
      break;
    case 'invoice.paid':
      console.log(`[notifications] would send payment receipt for invoice ${payload.invoiceId}`);
      break;
    default:
      console.log(`[notifications] unhandled event type ${eventType}`, payload);
  }
}

export function createNotificationsWorker(connection: IORedis): Worker<NotificationJobData> {
  return new Worker<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, handleNotification, {
    connection,
    concurrency: 5,
  });
}
