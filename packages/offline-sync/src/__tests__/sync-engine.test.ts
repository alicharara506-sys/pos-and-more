import { describe, expect, it, vi } from 'vitest';
import { MutationQueue } from '../mutation-queue';
import { InMemoryQueueStorageAdapter } from '../in-memory-adapter';
import { SyncEngine } from '../sync-engine';
import type { SubmitFn } from '../types';

function setup(submit: SubmitFn, online = true) {
  const adapter = new InMemoryQueueStorageAdapter();
  const queue = new MutationQueue(adapter, 3);
  const engine = new SyncEngine(queue, submit, () => online);
  return { adapter, queue, engine };
}

describe('SyncEngine', () => {
  it('never calls submit while offline', async () => {
    const submit = vi.fn();
    const { queue, engine } = setup(submit, false);
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });

    const result = await engine.runOnce();

    expect(submit).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, synced: 0, retriedLater: 0, dead: 0 });
  });

  it('a successful submit marks the item synced exactly once', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, data: { id: 'server-1' } });
    const { queue, engine } = setup(submit);
    await queue.enqueue({
      id: 'a',
      kind: 'sale.create',
      endpoint: '/sales',
      payload: { total: 10 },
    });

    const result = await engine.runOnce();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 1, synced: 1, retriedLater: 0, dead: 0 });

    const synced = await queue.listByStatus(['synced']);
    expect(synced).toHaveLength(1);
    expect(synced[0]!.serverResponse).toEqual({ id: 'server-1' });
  });

  it('a synced item is never resubmitted on a later pass — exactly-once sync', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const { queue, engine } = setup(submit);
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });

    await engine.runOnce();
    await engine.runOnce();
    await engine.runOnce();

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('a retryable failure schedules a future retry rather than dropping the item', async () => {
    const submit = vi
      .fn()
      .mockResolvedValue({ ok: false, retryable: true, error: 'network error' });
    const { queue, engine } = setup(submit);
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });

    const result = await engine.runOnce();

    expect(result).toEqual({ processed: 1, synced: 0, retriedLater: 1, dead: 0 });
    const failed = await queue.listByStatus(['failed']);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('does not re-attempt a failed item before its backoff window elapses', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: false, retryable: true, error: 'timeout' });
    const { queue, engine } = setup(submit);
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });

    await engine.runOnce(); // 1st attempt -> failed, backoff scheduled
    await engine.runOnce(Date.now()); // immediately again — should NOT re-submit yet

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('a non-retryable failure goes dead immediately, not retried', async () => {
    const submit = vi
      .fn()
      .mockResolvedValue({ ok: false, retryable: false, error: 'product deleted' });
    const { queue, engine } = setup(submit);
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });

    const result = await engine.runOnce();

    expect(result.dead).toBe(1);
    const dead = await queue.listByStatus(['dead']);
    expect(dead).toHaveLength(1);

    // A later pass must not resubmit a dead item.
    await engine.runOnce(Date.now() + 10_000_000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('an unexpected thrown error is treated as retryable, never silently discarded', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('unexpected'));
    const { queue, engine } = setup(submit);
    await queue.enqueue({ id: 'a', kind: 'sale.create', endpoint: '/sales', payload: {} });

    const result = await engine.runOnce();

    expect(result.retriedLater).toBe(1);
    const all = await queue.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.lastError).toBe('unexpected');
  });

  it('processes multiple queued items in creation order', async () => {
    const order: string[] = [];
    const submit: SubmitFn = vi.fn().mockImplementation(async (item) => {
      order.push(item.id);
      return { ok: true, data: {} };
    });
    const { queue, engine } = setup(submit);
    await queue.enqueue({ id: 'first', kind: 'sale.create', endpoint: '/sales', payload: {} });
    await queue.enqueue({ id: 'second', kind: 'sale.create', endpoint: '/sales', payload: {} });
    await queue.enqueue({ id: 'third', kind: 'sale.create', endpoint: '/sales', payload: {} });

    await engine.runOnce();

    expect(order).toEqual(['first', 'second', 'third']);
  });
});
