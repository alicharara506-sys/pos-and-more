import IORedis from 'ioredis';
import { loadEnv } from '@salesmaster/config';

/** Shared Redis connection for BullMQ. BullMQ requires maxRetriesPerRequest: null. */
export function createRedisConnection(): IORedis {
  const env = loadEnv();
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
