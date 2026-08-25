/**
 * Platform-agnostic offline mutation queue types. Nothing here depends on
 * React Native, SQLite, or any specific HTTP client — see
 * docs/offline-sync.md for the design this implements. apps/mobile supplies
 * a concrete `QueueStorageAdapter` backed by expo-sqlite and a `submit`
 * function backed by its API client; this package is what's actually unit
 * tested, using an in-memory adapter.
 */

export type QueueItemStatus =
  | 'pending' // never attempted yet
  | 'syncing' // an attempt is in flight
  | 'synced' // succeeded — terminal
  | 'failed' // a retryable attempt failed; will retry after nextAttemptAt
  | 'dead'; // retries exhausted, or a non-retryable error — needs manual action, never auto-deleted

export interface QueueItem<TPayload = unknown> {
  /** Also the idempotency key sent to the server as e.g. Sale.clientMutationId. */
  id: string;
  /** What kind of mutation this is, e.g. 'sale.create'. Used for routing + display. */
  kind: string;
  /** The relative API path to POST to, e.g. '/sales'. */
  endpoint: string;
  payload: TPayload;
  status: QueueItemStatus;
  attempts: number;
  lastError?: string;
  createdAt: number;
  nextAttemptAt: number;
  syncedAt?: number;
  /** The server's response body once synced — e.g. the created Sale record, for receipt display. */
  serverResponse?: unknown;
}

export interface QueueStorageAdapter {
  insert(item: QueueItem): Promise<void>;
  update(id: string, patch: Partial<QueueItem>): Promise<void>;
  get(id: string): Promise<QueueItem | undefined>;
  listByStatus(statuses: QueueItemStatus[]): Promise<QueueItem[]>;
  listAll(): Promise<QueueItem[]>;
}

export interface SubmitSuccess {
  ok: true;
  data: unknown;
}

export interface SubmitFailure {
  ok: false;
  /** True if this looks transient (network error, 5xx, timeout) and worth retrying. False for a permanent 4xx (e.g. validation failure). */
  retryable: boolean;
  error: string;
}

export type SubmitResult = SubmitSuccess | SubmitFailure;

export type SubmitFn = (item: QueueItem) => Promise<SubmitResult>;
