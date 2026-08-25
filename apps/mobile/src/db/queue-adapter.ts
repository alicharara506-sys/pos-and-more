import type { QueueItem, QueueItemStatus, QueueStorageAdapter } from '@salesmaster/offline-sync';
import { getDatabase } from './database';

interface QueueRow {
  id: string;
  kind: string;
  endpoint: string;
  payload: string;
  status: QueueItemStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  nextAttemptAt: number;
  syncedAt: number | null;
  serverResponse: string | null;
}

function rowToItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    kind: row.kind,
    endpoint: row.endpoint,
    payload: JSON.parse(row.payload),
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
    nextAttemptAt: row.nextAttemptAt,
    syncedAt: row.syncedAt ?? undefined,
    serverResponse: row.serverResponse ? JSON.parse(row.serverResponse) : undefined,
  };
}

/** expo-sqlite-backed implementation of packages/offline-sync's QueueStorageAdapter — the only platform-specific piece the sync engine needs. */
export class SqliteQueueStorageAdapter implements QueueStorageAdapter {
  async insert(item: QueueItem): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO mutation_queue (id, kind, endpoint, payload, status, attempts, lastError, createdAt, nextAttemptAt, syncedAt, serverResponse)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.kind,
        item.endpoint,
        JSON.stringify(item.payload),
        item.status,
        item.attempts,
        item.lastError ?? null,
        item.createdAt,
        item.nextAttemptAt,
        item.syncedAt ?? null,
        item.serverResponse !== undefined ? JSON.stringify(item.serverResponse) : null,
      ],
    );
  }

  async update(id: string, patch: Partial<QueueItem>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    const merged: QueueItem = { ...existing, ...patch };
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE mutation_queue SET status = ?, attempts = ?, lastError = ?, nextAttemptAt = ?, syncedAt = ?, serverResponse = ? WHERE id = ?`,
      [
        merged.status,
        merged.attempts,
        merged.lastError ?? null,
        merged.nextAttemptAt,
        merged.syncedAt ?? null,
        merged.serverResponse !== undefined ? JSON.stringify(merged.serverResponse) : null,
        id,
      ],
    );
  }

  async get(id: string): Promise<QueueItem | undefined> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<QueueRow>('SELECT * FROM mutation_queue WHERE id = ?', [id]);
    return row ? rowToItem(row) : undefined;
  }

  async listByStatus(statuses: QueueItemStatus[]): Promise<QueueItem[]> {
    if (statuses.length === 0) return [];
    const db = await getDatabase();
    const placeholders = statuses.map(() => '?').join(',');
    const rows = await db.getAllAsync<QueueRow>(
      `SELECT * FROM mutation_queue WHERE status IN (${placeholders}) ORDER BY createdAt ASC`,
      statuses,
    );
    return rows.map(rowToItem);
  }

  async listAll(): Promise<QueueItem[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<QueueRow>(
      'SELECT * FROM mutation_queue ORDER BY createdAt ASC',
    );
    return rows.map(rowToItem);
  }
}
