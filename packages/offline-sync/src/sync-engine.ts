import type { MutationQueue } from './mutation-queue';
import type { SubmitFn } from './types';

export interface SyncRunResult {
  processed: number;
  synced: number;
  retriedLater: number;
  dead: number;
}

/**
 * Runs one sync pass: pop every ready item (in creation order — see
 * MutationQueue.listReady) and attempt to submit it. Items are processed
 * sequentially, not in parallel, so a batch of offline sales syncs in the
 * order they were made (matters for anything that reads "most recent sale"
 * during the sync window).
 *
 * This class has no knowledge of network state, React Native, or SQLite —
 * `isOnline` and `submit` are both injected, so the whole engine is unit
 * testable with fakes (see src/__tests__/sync-engine.test.ts). apps/mobile
 * wires `isOnline` to NetInfo and `submit` to its real API client.
 */
export class SyncEngine {
  constructor(
    private readonly queue: MutationQueue,
    private readonly submit: SubmitFn,
    private readonly isOnline: () => Promise<boolean> | boolean,
  ) {}

  async runOnce(now: number = Date.now()): Promise<SyncRunResult> {
    const result: SyncRunResult = { processed: 0, synced: 0, retriedLater: 0, dead: 0 };

    if (!(await this.isOnline())) {
      return result;
    }

    const ready = await this.queue.listReady(now);

    for (const item of ready) {
      result.processed++;
      await this.queue.markSyncing(item.id);

      let outcome;
      try {
        outcome = await this.submit(item);
      } catch (err) {
        outcome = {
          ok: false as const,
          retryable: true,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (outcome.ok) {
        await this.queue.markSynced(item.id, outcome.data);
        result.synced++;
      } else if (outcome.retryable) {
        await this.queue.markRetryableFailure(item.id, outcome.error);
        result.retriedLater++;
      } else {
        await this.queue.markDead(item.id, outcome.error);
        result.dead++;
      }
    }

    return result;
  }
}
