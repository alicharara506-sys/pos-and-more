import NetInfo from '@react-native-community/netinfo';
import { SyncEngine, type SubmitFn, type SubmitResult } from '@salesmaster/offline-sync';
import { apiRequest, ApiError, isRetryableApiError } from '../api/client';
import { mutationQueue } from './queue';

const POLL_INTERVAL_MS = 10_000;

function buildSubmit(tenantId: string): SubmitFn {
  return async (item): Promise<SubmitResult> => {
    try {
      const data = await apiRequest(item.endpoint, {
        method: 'POST',
        body: item.payload,
        tenantId,
      });
      return { ok: true, data };
    } catch (err) {
      if (err instanceof ApiError) {
        return { ok: false, retryable: isRetryableApiError(err), error: err.message };
      }
      // A thrown non-ApiError from apiRequest is a network-layer failure (offline, DNS, timeout) — always retryable.
      return {
        ok: false,
        retryable: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

export interface SyncServiceHandle {
  /** Triggers an immediate sync pass regardless of the poll timer. Safe to call freely — a no-op while offline. */
  syncNow: () => Promise<void>;
  stop: () => void;
}

/**
 * Starts the background sync loop for a tenant: an immediate pass on
 * reconnect (via NetInfo) plus a periodic fallback poll, in case the
 * reconnect event is ever missed. Every pass is a no-op while offline —
 * see SyncEngine.runOnce, which checks `isOnline` before touching the
 * queue.
 */
export function startSyncService(tenantId: string): SyncServiceHandle {
  const engine = new SyncEngine(mutationQueue, buildSubmit(tenantId), async () => {
    const state = await NetInfo.fetch();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  });

  let running = false;
  const syncNow = async () => {
    if (running) return; // don't overlap passes
    running = true;
    try {
      await engine.runOnce();
    } finally {
      running = false;
    }
  };

  const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    if (state.isConnected) void syncNow();
  });

  const interval = setInterval(() => void syncNow(), POLL_INTERVAL_MS);
  void syncNow(); // attempt one immediately on start, in case we're already online

  return {
    syncNow,
    stop: () => {
      clearInterval(interval);
      unsubscribeNetInfo();
    },
  };
}
