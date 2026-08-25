import type { QueueItem, QueueItemStatus, QueueStorageAdapter } from './types';

/** Reference adapter used by this package's own tests. Not durable — apps/mobile uses a SQLite-backed adapter instead. */
export class InMemoryQueueStorageAdapter implements QueueStorageAdapter {
  private items = new Map<string, QueueItem>();

  async insert(item: QueueItem): Promise<void> {
    this.items.set(item.id, { ...item });
  }

  async update(id: string, patch: Partial<QueueItem>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) return;
    this.items.set(id, { ...existing, ...patch });
  }

  async get(id: string): Promise<QueueItem | undefined> {
    return this.items.get(id);
  }

  async listByStatus(statuses: QueueItemStatus[]): Promise<QueueItem[]> {
    return [...this.items.values()].filter((i) => statuses.includes(i.status));
  }

  async listAll(): Promise<QueueItem[]> {
    return [...this.items.values()];
  }
}
