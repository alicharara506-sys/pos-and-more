import { beforeEach, describe, expect, it } from 'vitest';
import { MutationQueue } from '../mutation-queue';
import { InMemoryQueueStorageAdapter } from '../in-memory-adapter';

describe('MutationQueue', () => {
  let adapter: InMemoryQueueStorageAdapter;
  let queue: MutationQueue;

  beforeEach(() => {
    adapter = new InMemoryQueueStorageAdapter();
    queue = new MutationQueue(adapter, 3);
  });

  it('enqueues a new item as pending, ready immediately', async () => {
    const item = await queue.enqueue({
      id: 'a',
      kind: 'sale.create',
      endpoint: '/sales',
      payload: { total: 10 },
    });
    expect(item.status).toBe('pending');
    expect(item.attempts).toBe(0);

    const ready = await queue.listReady();
    expect(ready.map((i) => i.id)).toEqual(['a']);
  });

  it('enqueuing the same id twice is idempotent — never creates a second entry', async () => {
    await queue.enqueue({
      id: 'dup',
      kind: 'sale.create',
      endpoint: '/sales',
      payload: { total: 1 },
    });
    await queue.enqueue({
      id: 'dup',
      kind: 'sale.create',
      endpoint: '/sales',
      payload: { total: 999 },
    });

    const all = await queue.listAll();
    expect(all).toHaveLength(1);
    expect((all[0]!.payload as { total: number }).total).toBe(1); // first write wins
  });

  it('preserves creation order in listReady', async () => {
    await queue.enqueue({ id: 'first', kind: 'sale.create', endpoint: '/sales', payload: {} });
    await queue.enqueue({ id: 'second', kind: 'sale.create', endpoint: '/sales', payload: {} });
    await queue.enqueue({ id: 'third', kind: 'sale.create', endpoint: '/sales', payload: {} });

    const ready = await queue.listReady();
    expect(ready.map((i) => i.id)).toEqual(['first', 'second', 'third']);
  });

  it('markRetryableFailure schedules a future retry and is excluded from listReady until then', async () => {
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });
    const now = Date.now();
    await queue.markRetryableFailure('a', 'network timeout');

    const item = await adapter.get('a');
    expect(item!.status).toBe('failed');
    expect(item!.attempts).toBe(1);
    expect(item!.nextAttemptAt).toBeGreaterThan(now);

    expect(await queue.listReady(now)).toHaveLength(0);
    expect(await queue.listReady(item!.nextAttemptAt + 1)).toHaveLength(1);
  });

  it('goes "dead" (stops auto-retrying) once maxAttempts is reached, but is never deleted', async () => {
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });

    await queue.markRetryableFailure('a', 'err1');
    await queue.markRetryableFailure('a', 'err2');
    await queue.markRetryableFailure('a', 'err3'); // 3rd attempt hits maxAttempts=3

    const item = await adapter.get('a');
    expect(item!.status).toBe('dead');
    expect(item!.lastError).toBe('err3');

    const all = await queue.listAll();
    expect(all).toHaveLength(1); // still present — never silently discarded
  });

  it('a permanent (non-retryable) failure goes straight to dead', async () => {
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });
    await queue.markDead('a', 'validation failed: product not found');

    const item = await adapter.get('a');
    expect(item!.status).toBe('dead');
  });

  it('manualRetry brings a dead item back to pending, immediately ready', async () => {
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });
    await queue.markDead('a', 'oops');
    await queue.manualRetry('a');

    const item = await adapter.get('a');
    expect(item!.status).toBe('pending');
    expect(await queue.listReady()).toHaveLength(1);
  });

  it('markSynced is terminal and excluded from listReady', async () => {
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });
    await queue.markSynced('a', { id: 'server-sale-id' });

    const item = await adapter.get('a');
    expect(item!.status).toBe('synced');
    expect(item!.serverResponse).toEqual({ id: 'server-sale-id' });
    expect(await queue.listReady()).toHaveLength(0);
  });
});
