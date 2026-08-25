import { computeBackoffMs } from './backoff';
import type { QueueItem, QueueItemStatus, QueueStorageAdapter } from './types';

export interface EnqueueInput<TPayload> {
  id: string;
  kind: string;
  endpoint: string;
  payload: TPayload;
}

const DEFAULT_MAX_ATTEMPTS = 8;

/**
 * The durable, ordered mutation queue itself (spec §9: "store local
 * mutations in a durable ordered queue"). Delegates actual persistence to a
 * `QueueStorageAdapter` so this class has zero platform dependencies and is
 * unit-testable with an in-memory adapter.
 */
export class MutationQueue {
  constructor(
    private readonly storage: QueueStorageAdapter,
    private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  ) {}

  /**
   * Enqueues a mutation. `id` MUST be a client-generated UUID reused as the
   * idempotency key on every sync attempt for this item — see
   * docs/offline-sync.md. Enqueuing the same `id` twice is a no-op (returns
   * the existing item unchanged) so a UI double-tap can't create two queue
   * entries for what the user intended as one action.
   */
  async enqueue<TPayload>(input: EnqueueInput<TPayload>): Promise<QueueItem<TPayload>> {
    const existing = await this.storage.get(input.id);
    if (existing) return existing as QueueItem<TPayload>;

    const now = Date.now();
    const item: QueueItem<TPayload> = {
      id: input.id,
      kind: input.kind,
      endpoint: input.endpoint,
      payload: input.payload,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      nextAttemptAt: now,
    };
    await this.storage.insert(item as QueueItem);
    return item;
  }

  /** Items eligible to attempt right now: pending, or failed with backoff elapsed — in creation order. */
  async listReady(now: number = Date.now()): Promise<QueueItem[]> {
    const candidates = await this.storage.listByStatus(['pending', 'failed']);
    return candidates
      .filter((item) => item.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async listAll(): Promise<QueueItem[]> {
    return this.storage.listAll();
  }

  async listByStatus(statuses: QueueItemStatus[]): Promise<QueueItem[]> {
    return this.storage.listByStatus(statuses);
  }

  async markSyncing(id: string): Promise<void> {
    await this.storage.update(id, { status: 'syncing' });
  }

  async markSynced(id: string, serverResponse: unknown): Promise<void> {
    await this.storage.update(id, {
      status: 'synced',
      syncedAt: Date.now(),
      serverResponse,
      lastError: undefined,
    });
  }

  /** A retryable failure: schedules the next attempt with exponential backoff, or goes 'dead' once attempts are exhausted. */
  async markRetryableFailure(id: string, error: string): Promise<void> {
    const item = await this.storage.get(id);
    const attempts = (item?.attempts ?? 0) + 1;
    if (attempts >= this.maxAttempts) {
      await this.storage.update(id, { status: 'dead', attempts, lastError: error });
      return;
    }
    await this.storage.update(id, {
      status: 'failed',
      attempts,
      lastError: error,
      nextAttemptAt: Date.now() + computeBackoffMs(attempts),
    });
  }

  /** A permanent failure (e.g. 4xx validation error) — no point retrying automatically. */
  async markDead(id: string, error: string): Promise<void> {
    const item = await this.storage.get(id);
    await this.storage.update(id, {
      status: 'dead',
      attempts: (item?.attempts ?? 0) + 1,
      lastError: error,
    });
  }

  /** User-initiated retry of a 'dead' item — never happens automatically. */
  async manualRetry(id: string): Promise<void> {
    await this.storage.update(id, { status: 'pending', nextAttemptAt: Date.now() });
  }
}
