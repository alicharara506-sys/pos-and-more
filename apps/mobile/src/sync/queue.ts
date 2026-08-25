import { MutationQueue } from '@salesmaster/offline-sync';
import { SqliteQueueStorageAdapter } from '../db/queue-adapter';

/** One shared queue instance for the whole app — the SQLite table underneath is the real durability, not this singleton. */
export const mutationQueue = new MutationQueue(new SqliteQueueStorageAdapter());
