# E-commerce integration hub

**Status: implemented for WooCommerce.** Connection management, product/inventory sync, and
signed webhook ingestion are real and tested against a fixture store — see "What's honestly not
done" below for what this phase deliberately left out.

## Connector contract

```ts
interface CommerceConnector {
  authorize(credentials): Promise<ConnectionResult>;
  testConnection(credentials): Promise<HealthResult>;
  pullProducts(credentials, cursor?): Promise<Page<ExternalProduct>>;
  pullOrders(credentials, cursor?): Promise<Page<ExternalOrder>>;
  pushInventory(credentials, updates): Promise<PushResult>;
  registerWebhooks(credentials, callbackUrl): Promise<WebhookRegistrationResult>;
  verifyWebhook(credentials, request: RawWebhookRequest): Promise<VerifiedWebhook>;
  normalizeWebhookPayload(payload): Promise<CanonicalCommerceEvent[]>;
}
```

Defined in `packages/integrations/src/types.ts`. Every provider-specific connector implements this
interface, and `apps/api`'s `IntegrationsService` only ever talks to it — the whole point being
that a new platform is a new connector, not a change to core sales/inventory logic.

## What's built

- **`packages/integrations`** — the connector SDK:
  - `UniversalRestConnector` (`connectors/universal-rest-connector.ts`) — a configurable REST
    adapter: pluggable auth headers, pagination (`applyCursor`/`parsePage`, including
    header-based pagination like WooCommerce's `X-WP-TotalPages`), and dot-path field mapping for
    both products and orders.
  - `createWooCommerceConnector()` (`connectors/woocommerce-connector.ts`) — WooCommerce built as
    a fully-specified configuration of `UniversalRestConnector`, plus WooCommerce-specific bits
    that don't generalize: Basic-auth header construction from `consumerKey`/`consumerSecret`,
    webhook registration via WooCommerce's `/webhooks` endpoint, and HMAC-SHA256 webhook signature
    verification (`x-wc-webhook-signature`) using `timingSafeEqual`.
  - `withRetry()` (`retry.ts`) — retry with backoff for transient HTTP failures.
  - Realistic fixture data (`fixtures/`) and unit tests (`__tests__/`) — 9 tests, no network calls.

- **`apps/api/src/integrations`**:
  - `CommerceConnection` (encrypted credentials via the same `EncryptionService` used for OAuth
    provider tokens — AES-256-GCM, never stored or returned in plaintext), `ExternalObjectMap`
    (external id ↔ canonical id, the idempotency key for sync), `SyncJob` (one row per sync
    attempt, per domain/direction), `WebhookDelivery` (raw inbound payloads, deduped on
    `(connectionId, externalEventId)`).
  - `ConnectorRegistry.resolve(provider, storeUrl)` — the one place that maps a `CommerceProvider`
    enum value to a concrete connector. Only `WOOCOMMERCE` resolves to a working connector today;
    `SHOPIFY` and `UNIVERSAL_REST` throw an explicit "not implemented in this phase" error rather
    than silently no-op.
  - `IntegrationsService`: `createConnection` (authorizes against the real store before saving),
    `syncProducts` (pulls every page, upserts canonical products/variants, merges onto an
    existing product by SKU on first sync instead of duplicating it), `pushInventory` (pushes
    current stock for every already-mapped variant — never guesses an external id for an unmapped
    one), `handleWebhook` (verifies signature → 401 on failure, dedupes via `WebhookDelivery`'s
    unique constraint → `{ deduplicated: true }` on replay, otherwise records the delivery),
    `getConnectionHealth` (status, last sync/error, recent sync jobs, webhook delivered/failed
    counts — what the dashboard renders).
  - REST endpoints: `GET/POST /integrations/connections`, `GET /integrations/connections/:id/health`,
    `POST /integrations/connections/:id/{test,disconnect,sync}`, and the public (signature-verified,
    not session-authenticated) `POST /integrations/webhooks/:connectionId`.
  - Raw-body handling: the webhook route is exempted from the global JSON body parser in
    `main.ts` (`express.raw()`, registered under the `/api/v1` prefix, before `express.json()`) so
    signature verification runs against the exact bytes the provider sent, not a re-serialized
    JSON object. The integration test harness (`apps/api/test/integration/helpers.ts`) mirrors
    this exactly, which is how a body-parser regression here would get caught.

- **`apps/web/app/(dashboard)/integrations`** — the integration health dashboard: lists
  connections with status/last-sync/last-error, a "Connect WooCommerce store" form, per-connection
  Test/Sync products/Push inventory/Disconnect actions, and an expandable details panel showing
  recent sync jobs and webhook delivered/failed counts (`GET /integrations/connections/:id/health`).

## Verified behavior (not just unit-tested — exercised against a real running API + fixture store)

- Creating a connection genuinely calls the store's API (`testConnection`) before saving; a store
  that doesn't respond correctly is rejected, never marked `CONNECTED` on faith.
- Running a product sync twice never creates a duplicate canonical product — the second run
  updates the same row via `ExternalObjectMap`.
- Replaying an identical signed webhook delivery is a no-op (`{ deduplicated: true }`), not a
  double-applied update.
- An invalid webhook signature is rejected with 401, never a 500.
- The full flow — connect → sync products → see the item in the product catalog — was walked
  through in a real browser against a live dev server and a throwaway fixture WooCommerce store.

Automated coverage: `packages/integrations/src/__tests__/*.test.ts` (9 tests, pure/no network) and
`apps/api/test/integration/integrations.spec.ts` (4 tests, against a real Postgres-backed API and
an in-process fixture store) — both run in CI.

## What's honestly not done

- **Only WooCommerce has a working connector.** Shopify and other native connectors from spec
  §13.1's list (Wix, Squarespace, BigCommerce, Magento, OpenCart, Ecwid, PrestaShop) are not
  built. `UNIVERSAL_REST` self-serve configuration (a merchant supplying their own field mapping
  through the UI, rather than a developer wiring a `UniversalRestConnectorConfig` in code) is not
  built either — the class exists and is exercised by the WooCommerce connector, but there's no
  API/UI path for a merchant to configure one directly.
- **Orders are not materialized into `Sale` records.** An order webhook is verified and recorded
  in `WebhookDelivery` for traceability, but turning it into a `Sale` needs a merchant-configured
  default branch/stock-location per connection, which doesn't exist yet. `pullOrders` on the
  connector works and is unit-tested; nothing in `apps/api` calls it yet.
  `POST /integrations/connections/:id/sync` explicitly rejects `ORDERS`/`CUSTOMERS` domains with
  a "not implemented in this phase" error rather than silently accepting and doing nothing.
- **No inbound (pull) inventory sync.** `pushInventory` is one-way, SalesMaster → store, for
  variants already mapped by a prior product sync. There's no path for the store's stock levels
  to flow back in, so the "two-way sync must not create a feedback loop" tagging described as a
  future requirement doesn't apply yet — there's no loop to create.
- **File bridge (CSV/XLSX import/export)** for platforms with no usable API is not built.
- **No OAuth-based connectors.** WooCommerce authenticates with a static API key/secret pair the
  merchant pastes in; the OAuth-authorize dance a Shopify-style connector would need is unbuilt.
- **Sync is synchronous and on-demand**, triggered by a dashboard button — not scheduled, not
  running through the outbox/BullMQ worker the way notifications do. A large catalog sync blocks
  the requesting HTTP call for its full duration.
