import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { loadEnv } from '@salesmaster/config';
import { prisma } from '@salesmaster/database';
import { type EmailAdapter, resolveEmailAdapter } from '@salesmaster/notifications';

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

function logDelivery(context: string, result: { delivered: boolean; provider: string }) {
  console.log(
    `[notifications] ${context} — provider=${result.provider} delivered=${result.delivered}`,
  );
}

/**
 * Handles the actual side-effect for each outbox event type. This is
 * deliberately the ONLY place in the system that would call a real
 * notification provider — never inside a request-handling DB transaction
 * (spec §16). Every branch here goes through the real `EmailAdapter.send()`
 * call, so the moment EMAIL_PROVIDER points at a configured real provider
 * this starts actually delivering — with no live key in this environment
 * today, the ConsoleEmailAdapter's `delivered: false` result is logged
 * honestly rather than claimed as a send (see packages/notifications).
 */
export async function handleNotification(
  job: Job<NotificationJobData>,
  email: EmailAdapter,
): Promise<void> {
  const { eventType, payload } = job.data;
  const appUrl = loadEnv().APP_URL;

  switch (eventType) {
    case 'tenant.created': {
      const tenant = await prisma.tenant.findUnique({ where: { id: payload.tenantId as string } });
      if (!tenant) return;
      const result = await email.send({
        to: payload.ownerEmail as string,
        subject: `Welcome to SalesMaster Pro, ${tenant.displayName}`,
        text: `Your business "${tenant.displayName}" is set up and ready to go. Sign in any time at ${appUrl}/login.`,
      });
      logDelivery(`welcome email for tenant ${tenant.id}`, result);
      break;
    }
    case 'invitation.created': {
      const invitation = await prisma.invitation.findUnique({
        where: { token: payload.token as string },
        include: { tenant: true },
      });
      if (!invitation) return;
      const acceptUrl = `${appUrl}/accept-invite?token=${invitation.token}`;
      const result = await email.send({
        to: invitation.email,
        subject: `You've been invited to join ${invitation.tenant.displayName} on SalesMaster Pro`,
        text: `Accept your invitation: ${acceptUrl}\n\nThis link expires ${invitation.expiresAt.toISOString()}.`,
      });
      logDelivery(`invitation email to ${invitation.email}`, result);
      break;
    }
    case 'sale.created':
      console.log(`[notifications] sale ${payload.saleId} recorded for tenant ${payload.tenantId}`);
      break;
    case 'sale.refunded':
      console.log(
        `[notifications] refund of ${payload.amount} recorded for sale ${payload.saleId}`,
      );
      break;
    case 'invoice.issued': {
      const invoice = await prisma.invoice.findUnique({
        where: { id: payload.invoiceId as string },
        include: { customer: true, tenant: true },
      });
      if (!invoice || !invoice.customer.email) {
        console.log(
          `[notifications] invoice ${payload.invoiceId} issued but customer has no email on file — skipping`,
        );
        break;
      }
      const viewUrl = `${appUrl}/public/invoices/${invoice.publicToken}`;
      const result = await email.send({
        to: invoice.customer.email,
        subject: `Invoice ${invoice.number} from ${invoice.tenant.displayName}`,
        text: `You have a new invoice for ${invoice.currency} ${invoice.total.toString()}. View and pay: ${viewUrl}`,
      });
      logDelivery(`invoice ${invoice.number} issued email`, result);
      break;
    }
    case 'invoice.paid': {
      const invoice = await prisma.invoice.findUnique({
        where: { id: payload.invoiceId as string },
        include: { customer: true, tenant: true },
      });
      if (!invoice || !invoice.customer.email) {
        console.log(
          `[notifications] invoice ${payload.invoiceId} paid but customer has no email on file — skipping`,
        );
        break;
      }
      const viewUrl = `${appUrl}/public/invoices/${invoice.publicToken}`;
      const result = await email.send({
        to: invoice.customer.email,
        subject: `Payment received — invoice ${invoice.number}`,
        text: `Thank you! We've recorded your payment for invoice ${invoice.number}. Receipt: ${viewUrl}`,
      });
      logDelivery(`invoice ${invoice.number} paid receipt email`, result);
      break;
    }
    case 'inventory.low_stock': {
      const owners = await prisma.membership.findMany({
        where: { tenantId: payload.tenantId as string, role: { key: 'owner' }, status: 'ACTIVE' },
        include: { user: true },
      });
      for (const owner of owners) {
        const result = await email.send({
          to: owner.user.email,
          subject: `Low stock alert: ${payload.productName}`,
          text: `"${payload.productName}" (SKU ${payload.sku}) is at ${payload.quantity} units on hand, at or below its reorder point. Restock soon to avoid stockouts.`,
        });
        logDelivery(`low-stock alert to ${owner.user.email}`, result);
      }
      break;
    }
    default:
      console.log(`[notifications] unhandled event type ${eventType}`, payload);
  }
}

export function createNotificationsWorker(connection: IORedis): Worker<NotificationJobData> {
  const email = resolveEmailAdapter(loadEnv());
  return new Worker<NotificationJobData>(
    NOTIFICATIONS_QUEUE_NAME,
    (job) => handleNotification(job, email),
    { connection, concurrency: 5 },
  );
}
