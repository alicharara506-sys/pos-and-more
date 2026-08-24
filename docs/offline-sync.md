# Offline-first mobile sync — design (not yet implemented)

**Status: design only.** `apps/mobile` is currently a placeholder Expo screen (see its `App.tsx`).
No local database, mutation queue, or sync engine exists yet. This document records the intended
design so a future phase implements it consistently with the rest of the system, and so nobody
mistakes the placeholder for a working offline POS.

## Why this matters

The spec treats offline sales as a hard requirement, not a cosmetic "offline indicator" — a
cashier must be able to complete a sale with no connectivity, and that sale must survive an app
restart and sync exactly once when connectivity returns. Below is the design this phase's backend
was already built to support (idempotency keys, append-only ledger, decimal-safe totals) so that
implementing the client doesn't require backend changes.

## Local data

- SQLite on-device, storing: authorized products/variants/prices/tax rules for the cashier's
  branch, a recent customer cache, and local stock snapshots for the branch's stock location(s).
- Refreshed opportunistically whenever the device is online, scoped by the same tenant/branch
  authorization the API already enforces server-side — the client never caches data the API
  wouldn't have returned to that user anyway.

## Mutation queue

- Every offline-created record (sale, payment, customer, permitted stock operation) is appended to
  a durable, ordered local queue, keyed by a **client-generated UUID** (`clientMutationId`).
- The API already accepts and enforces this: `POST /sales` takes a required `clientMutationId`,
  and `Sale` has a `@@unique([tenantId, clientMutationId])` constraint — replaying the same
  mutation (e.g. after a network retry, or the app being killed mid-sync and restarted) returns the
  original sale rather than creating a duplicate. This is exercised today by
  `apps/api/test/integration/sales.spec.ts`'s idempotency test, using the exact same endpoint the
  mobile client would call once built.
- Each queue entry has a state machine: `pending → syncing → synced` or `pending → syncing →
failed → pending` (retry). The UI must always be able to show this per-item, never silently drop
  a `failed` entry.

## Sync algorithm (intended)

1. On reconnect (or on a timer while online), pop queue entries in order.
2. POST each to its corresponding endpoint with its `clientMutationId`.
3. On `2xx`: mark `synced`, remove from the queue (keep a short local history for the "recently
   synced" UI state).
4. On a network-layer failure: mark `failed`, retry with exponential backoff (the same class of
   backoff the outbox worker already uses server-side — see `docs/architecture.md`).
5. On a `4xx` validation/authorization failure: mark `failed` with the server's message attached,
   surface it to the user as an actionable error (e.g. "this product was deleted on the server") —
   never silently discard the mutation.

## Conflict rules

- **Financial records (sales, payments, refunds) are append-only.** There is no local "edit" of a
  synced sale — corrections happen through the existing refund/adjustment endpoints, which are
  themselves ledger entries, not mutations of the original record. This means sales sync with a
  trivial conflict rule: last-write-wins is not needed because there is nothing to overwrite.
- **Inventory** is never resolved by comparing local vs. server quantities. A locally-recorded sale
  syncs as an `InventoryMovement` with a negative delta, same as an online sale — the server-side
  ledger (see `docs/data-model.md`) is what reconciles concurrent offline sales from multiple
  devices against the same stock, exactly as it already reconciles concurrent online sales.
- **Product/customer metadata edits** (not yet relevant until the mobile app can edit them offline)
  would use field-level version checks (an `updatedAt` or version column compared at sync time),
  not whole-record last-write-wins, so an offline price change doesn't silently clobber an unrelated
  online description change.

## Recovery

- A `failed` queue entry is never auto-deleted. The user can view it, see the reason, retry
  manually, or (for a genuinely invalid mutation, e.g. a deleted product) discard it explicitly.
- App restart reloads the queue from SQLite before allowing new POS activity, so a killed app
  never loses a pending offline sale.
