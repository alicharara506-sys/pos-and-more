# Offline-first mobile sync

**Status: implemented.** `apps/mobile` is a working Expo/React Native POS app: login, an
on-device SQLite cache of the authorized catalog/customer/branch data, an offline-capable POS
screen, a durable mutation queue, and a background sync engine that drains it against the real
API. This document describes what's actually built — see `docs/architecture.md` for how it fits
the rest of the system.

## Why this matters

The spec treats offline sales as a hard requirement, not a cosmetic "offline indicator" — a
cashier must be able to complete a sale with no connectivity, and that sale must survive an app
restart and sync exactly once when connectivity returns.

## Architecture: platform-agnostic core + thin platform wiring

The actual queue/backoff/sync-decision logic lives in `packages/offline-sync`, which has **zero
dependency on React Native, SQLite, or any HTTP client** — it's plain TypeScript, unit tested
with an in-memory storage adapter (19 tests: `packages/offline-sync/src/__tests__/`). `apps/mobile`
supplies the only two platform-specific pieces:

- `apps/mobile/src/db/queue-adapter.ts` — a `QueueStorageAdapter` implementation backed by
  `expo-sqlite`.
- `apps/mobile/src/sync/sync-service.ts` — wires `SyncEngine` to `@react-native-community/netinfo`
  for connectivity detection and to the real API client for submission.

This split means the hard part (queue state transitions, backoff scheduling, exactly-once-per-pass
submission, dead-letter handling) is verified by fast, deterministic unit tests without needing a
device, simulator, or network — see `packages/offline-sync/src/__tests__/sync-engine.test.ts` for
tests that assert a synced item is never resubmitted, a retryable failure is retried with
exponential backoff and not before, a permanent failure goes straight to a `dead` state instead of
retrying forever, and the queue is processed in creation order.

## Local data (`apps/mobile/src/db`)

On-device SQLite (`expo-sqlite`), schema in `src/db/schema.ts`:

- `cached_variants`, `cached_customers` — the authorized catalog/customer data for the current
  tenant, refreshed via `src/sync/catalog-sync.ts`'s `syncCatalogDown()` whenever the app has
  connectivity (on login, and on a manual "Refresh catalog" tap). This pulls from the exact same
  `GET /products`, `GET /customers`, `GET /branches` endpoints the web app uses — nothing the
  mobile app caches is data the API wouldn't have returned to this authenticated user anyway.
- `active_branch` — the single branch/stock-location/register this device is currently operating
  as (a cashier device is scoped to one branch at a time).
- `mutation_queue` — the durable, ordered offline mutation queue itself.

## Mutation queue and offline sale flow

`apps/mobile/src/screens/PosScreen.tsx`'s checkout handler is the whole offline path:

```ts
await mutationQueue.enqueue({
  id: clientMutationId,
  kind: 'sale.create',
  endpoint: '/sales',
  payload,
});
```

That's it — no network call happens on checkout. `clientMutationId` is a client-generated UUID
(`expo-crypto`'s `randomUUID()`), reused as the idempotency key on every sync attempt. The API
already enforces this end-to-end: `POST /sales` requires `clientMutationId`, and `Sale` has a
`@@unique([tenantId, clientMutationId])` constraint — replaying the same mutation (a retry, or the
app being killed mid-sync and restarted) returns the original sale rather than creating a
duplicate. This exact behavior is covered by
`apps/api/test/integration/sales.spec.ts`'s idempotency test, using the identical endpoint the
mobile client calls.

A locally-cached stock quantity is optimistically decremented at the same time
(`decrementCachedStock`) purely so a second offline sale in the same session doesn't oversell
against a stale number in the UI — this is a same-device UX guard only. The server-side inventory
ledger (`apps/api`'s `InventoryService`, append-only, upserted atomically) is the real source of
truth and re-validates independently when the sale syncs.

## Sync engine

`apps/mobile/src/sync/sync-service.ts`'s `startSyncService(tenantId)`:

- Subscribes to `NetInfo` and triggers an immediate sync pass on reconnect.
- Also polls every 10s as a fallback, in case a reconnect event is ever missed.
- Each pass (`SyncEngine.runOnce`) is a complete no-op while offline — it checks connectivity
  before touching the queue at all.
- Items are submitted **sequentially, in creation order** — a batch of offline sales syncs in the
  order they were rung up, not in parallel.

Item states: `pending → syncing → synced` (terminal), or `pending → syncing → failed` (retryable,
exponential backoff via `packages/offline-sync/src/backoff.ts`, capped at 5 minutes) → eventually
`dead` after 8 attempts, or straight to `dead` on a non-retryable failure (a 4xx like a deleted
product) since retrying an unchanged payload against the same validation error would never
succeed. **A queue item is never silently deleted** — `dead` items stay visible with their last
error and a manual "Retry" action (`apps/mobile/src/screens/QueueScreen.tsx`).

Retryability is decided by `apps/mobile/src/api/client.ts`'s `isRetryableApiError`: network-layer
failures (fetch threw — no connectivity, DNS failure) and 5xx/408/429 responses are retryable;
4xx validation/auth/conflict responses are not.

## Conflict rules

- **Financial records (sales, payments, refunds) are append-only.** There is no local "edit" of a
  synced sale — corrections happen through the existing refund/adjustment endpoints, which are
  themselves ledger entries, not mutations of the original record. This means sales sync with a
  trivial conflict rule: last-write-wins is not needed because there is nothing to overwrite.
- **Inventory** is never resolved by comparing local vs. server quantities. A locally-recorded sale
  syncs as a real `POST /sales` call, which creates the same `InventoryMovement` ledger entry an
  online sale would — the server-side ledger is what reconciles concurrent offline sales from
  multiple devices against the same stock, exactly as it already reconciles concurrent online
  sales (see `docs/data-model.md`).
- **Product/customer metadata edits** are not yet offline-editable from the mobile app (the app
  only creates sales offline today), so there is no field-level conflict case to resolve yet. If/when
  offline product or customer edits are added, they should use field-level version checks (an
  `updatedAt` comparison at sync time), not whole-record last-write-wins.

## Recovery

- A `dead` queue entry is never auto-deleted — the cashier can see it, see the reason
  (`QueueScreen`), and manually retry.
- SQLite is durable device storage — the queue survives an app restart or crash. On next launch,
  the queue simply resumes wherever it left off; there is no separate "recovery" step needed
  because nothing is held only in memory.

## What's honestly not done

- **Auth token expiry mid-queue**: an expired session token currently surfaces as a non-retryable
  (`dead`) failure on whatever item hits it, with the raw 401 message as `lastError`. There is no
  "pause the queue, prompt re-login, resume" flow yet — a cashier would need to sign back in and
  manually retry the affected items.
- **Product/customer creation offline** is not implemented — only sales. The queue and sync engine
  are generic (`kind`/`endpoint`/`payload`), so adding another offline-capable mutation type is a
  new enqueue call plus a new API DTO, not a new sync mechanism.
- **Verification**: this app's business logic (the mutation queue and sync engine) is unit tested
  and its full source successfully bundles through the real Metro/Expo toolchain (confirmed via
  `expo export`, which resolved and bundled all of `apps/mobile`'s source alongside
  `packages/offline-sync` and `packages/contracts`). Bundling was confirmed working through Metro's
  resolver — the same resolver layer used for iOS/Android — but this sandboxed environment has no
  iOS/Android simulator or physical device, so the app has not been visually run or interacted with
  on a real target. Two pnpm-monorepo-specific Metro resolution issues were found and fixed along
  the way (`apps/mobile/metro.config.js`'s workspace-root config, and a custom `apps/mobile/index.js`
  entry point that avoids `expo/AppEntry.js`'s relative-import assumption, which does not hold in a
  monorepo) — both fixes are platform-agnostic and apply to iOS/Android bundling too, not just the
  diagnostic web bundle used to confirm them.
