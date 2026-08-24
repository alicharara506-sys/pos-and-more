import { loadEnv } from '@salesmaster/config';
import { prisma } from '@salesmaster/database';
import { createRedisConnection } from './redis';
import { createNotificationsQueue, createNotificationsWorker } from './queues/notifications.queue';
import { pollOutboxOnce } from './outbox-poller';

const POLL_INTERVAL_MS = 5_000;

async function main() {
  loadEnv(); // fail fast on misconfiguration

  const connection = createRedisConnection();
  const queue = createNotificationsQueue(connection);
  const worker = createNotificationsWorker(connection);

  worker.on('failed', (job, err) => {
    console.error(`[notifications] job ${job?.id} failed: ${err.message}`);
  });

  console.log('SalesMaster Pro worker started — polling outbox every %dms', POLL_INTERVAL_MS);

  let stopping = false;
  const interval = setInterval(async () => {
    if (stopping) return;
    try {
      const processed = await pollOutboxOnce(queue);
      if (processed > 0) console.log(`[outbox] enqueued ${processed} event(s)`);
    } catch (err) {
      console.error('[outbox] poll failed', err);
    }
  }, POLL_INTERVAL_MS);

  async function shutdown() {
    stopping = true;
    clearInterval(interval);
    await worker.close();
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Worker failed to start', err);
  process.exit(1);
});
