# E-commerce integration hub — design (not yet implemented)

**Status: design only.** No connector, webhook receiver, or sync job exists yet in this phase.
This document records the intended architecture — the connector contract in particular — so a
future phase's native Shopify/WooCommerce connectors and the universal REST/GraphQL connector are
all interchangeable behind one interface, matching spec §13.

## Connector contract

```ts
interface CommerceConnector {
  authorize(input: AuthorizationInput): Promise<ConnectionResult>;
  testConnection(connectionId: string): Promise<HealthResult>;
  pullProducts(cursor?: string): Promise<Page<ExternalProduct>>;
  pushProduct(product: CanonicalProduct): Promise<ExternalReference>;
  pullOrders(cursor?: string): Promise<Page<ExternalOrder>>;
  pushInventory(updates: InventoryUpdate[]): Promise<PushResult>;
  registerWebhooks(): Promise<WebhookRegistrationResult>;
  verifyWebhook(request: RawWebhookRequest): Promise<VerifiedWebhook>;
  normalize(payload: unknown): Promise<CanonicalCommerceEvent[]>;
}
```

Provider payloads never reach `apps/api`'s core sales/inventory logic directly — every connector's
`normalize()` maps its provider's shape into the same canonical `Product`/`Order` types the POS
already uses (`packages/contracts`), and raw payloads are retained (in a `WebhookDelivery`-style
table, not yet migrated) for a bounded retention window for traceability, not fed straight into
domain logic.

## Four integration layers (per spec §13.1)

1. **Native connectors** — first-class adapters for Shopify and WooCommerce, then Wix,
   Squarespace, BigCommerce, Magento, OpenCart, Ecwid, PrestaShop.
2. **Universal API connector** — a configurable REST/GraphQL adapter (auth, field mapping,
   pagination, rate limits, webhook registration) for custom stores.
3. **Connector SDK** — the interface above plus an example connector, documented well enough that
   a third-party developer can add a platform without touching core sales/inventory code.
4. **File bridge** — validated CSV/XLSX import/export and scheduled secure-upload exchange for
   platforms with no usable API. This is the only "integration" that's honest to promise for a
   closed platform — never claim real-time sync where the source platform makes it impossible.

## Reliability requirements a real implementation must meet

- Encrypt store access tokens/secrets at rest — the same `EncryptionService`
  (`apps/api/src/common/crypto`) already used for OAuth provider tokens is the right tool; a
  connector's tokens should live in a `CommerceConnection` table with the same
  encrypt-at-rest treatment as `IdentityProviderAccount.refreshTokenEncrypted`.
- Verify webhook signatures before processing anything from the payload — same posture as the
  Stripe webhook handler in `apps/api/src/billing/webhooks`, which is a working reference for "how
  this codebase does signature verification + idempotent processing."
- Idempotency: an `ExternalObjectMap` (external id ↔ canonical id) prevents a replayed webhook or
  a re-run historical import from creating duplicate products/orders — update the mapped record,
  never recreate it.
- Two-way inventory sync must not create a feedback loop: a stock change written _because of_ an
  inbound sync must be tagged (e.g. `sourceType: 'commerce_sync'` on the resulting
  `InventoryMovement`, a column that already exists) so it's never re-pushed back to the same
  connection as if it originated locally.
- Pagination, provider rate limits, retries with backoff, and a dead-letter path for a sync job
  that keeps failing — the outbox + BullMQ pattern already built for notifications
  (`docs/architecture.md`) is the intended reuse point, not a second bespoke queue.

## Why none of this is implemented yet

This phase's scope was the foundation, billing, and the core web POS (see the top-level README).
Building even one real native connector (Shopify or WooCommerce) end-to-end — OAuth, webhook
registration, canonical mapping, sandbox-fixture contract tests — is a substantial phase on its
own; faking a "connected" state without a real store to sync against would violate the project's
core rule against claiming a success that didn't happen.
