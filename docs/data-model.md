# Data model

Full source of truth: `packages/database/prisma/schema.prisma`. This document explains the
relationships and the tenant-isolation strategy; it does not restate every column.

## Tenant isolation strategy

Every tenant-owned table has a **required, non-nullable** `tenantId` column. The rule enforced
throughout `apps/api`:

1. `tenantId` is never accepted from the client as a trusted value. It is resolved exactly once,
   server-side, by `TenantGuard` from the authenticated user's `Membership` row for the tenant
   named in the `X-Tenant-Id` header.
2. Every read filters by that resolved `tenantId`. Lookups by primary key alone
   (`findUnique({ where: { id } })`) are only used where the id itself is already tenant-scoped
   through a `findFirst({ where: { id, tenantId } })` immediately before, or where the table's
   only access path already passed through a tenant-scoped parent in the same request.
3. Every write (`update`, `delete`) that targets a row by id uses `updateMany`/`deleteMany` with
   `tenantId` **in the same `where`**, not a bare `update({ where: { id } })` — so an id belonging
   to another tenant matches zero rows instead of ever being touched. See
   `apps/api/src/branches/branches.controller.ts`'s archive endpoint for the pattern.
4. Automated tests in `apps/api/test/integration/tenant-isolation.spec.ts` create two independent
   tenants and assert tenant B can never read, list, or mutate tenant A's data — including by
   guessing a valid resource id.

Two tables intentionally have a **nullable** `tenantId`: `Role` (system role templates, shared
across tenants, `tenantId: null`) and `AuditEvent` (platform-admin actions that aren't scoped to
any tenant). Everywhere else, `tenantId` is required.

## Entity map

```text
Tenant
├── Subscription ──< SubscriptionItem >── PricingCatalogItem
├── BillingEvent
├── Membership >── User
│                └── Role >── RolePermission
├── Invitation
├── Branch
│   ├── StockLocation ──< InventoryBalance, InventoryMovement
│   ├── Register ──< CashDrawerSession
│   ├── Sale, Invoice, Quote, Expense (branch-scoped)
├── Category, TaxClass
├── Product ──< ProductVariant ──< InventoryMovement, InventoryBalance, SaleLine, InvoiceLine
│           └── ProductImage
├── Customer ──< CustomerAddress, LoyaltyAccount ──< LoyaltyTransaction
├── Sale ──< SaleLine, Payment, Refund
├── Invoice ──< InvoiceLine, Payment, CreditNote
├── Quote ──< QuoteLine (may convert into an Invoice)
├── StockTransfer ──< StockTransferLine
├── ExpenseCategory ──< Expense
└── AuditEvent (tenantId nullable for platform-admin actions)

User ──< IdentityProviderAccount (Google/Apple, keyed by provider `sub`, not email)
     ──< Session (opaque, revocable), Device
```

`OutboxEvent` is intentionally NOT tenant-scoped as a first-class filter — it's an implementation
detail of the transactional-outbox pattern, and its `payload` JSON carries whatever tenant context
the triggering write needs.

## Money and time

- All monetary columns are `Decimal` (Postgres `NUMERIC`), never `Float`. Application code passes
  them through `packages/domain`'s `Money` class (backed by `decimal.js`) for any arithmetic —
  see `docs/billing.md` for why this matters for the pricing formula specifically.
- Timestamps are stored in UTC (`DateTime` / `timestamptz`); tenant-local presentation happens in
  the client. Per-tenant timezone-aware report _bucketing_ (as opposed to display) is not yet
  implemented — see `docs/architecture.md`'s known simplifications.

## Inventory: ledger, not a mutable counter

`InventoryMovement` is append-only — every stock change (sale, return, purchase receipt, transfer,
adjustment, damage, etc.) is its own row with a `quantityDelta` and the `resultingBalance`
immediately after that movement. `InventoryBalance` is a **maintained projection** (one row per
`(stockLocation, variant)`, upserted atomically via Postgres's `ON CONFLICT` semantics on every
movement) used for fast reads — it is never treated as the source of truth, and it can always be
rebuilt by replaying `InventoryMovement` rows in order (`packages/domain/src/inventory.ts`'s
`replayBalance` is exactly that replay function, unit tested).

## Entities described in the spec but not yet in the schema

The full spec (§20) also calls for `Supplier`, `SupplierProduct`, `PurchaseOrder`,
`PurchaseOrderLine`, `GoodsReceipt`, `CommerceConnection`, `ExternalObjectMap`, `SyncCursor`,
`SyncJob`, `WebhookDelivery`, `Notification`, `MessageTemplate`, `DeliveryAttempt`,
`AIConversation`, `AIMessage`, `AIToolInvocation`, and `AIUsageRecord`. These belong to purchasing,
the commerce integration hub, the notification system, and the AI assistant — none of which are
implemented in this phase (see `docs/integrations.md` and the README). They are deliberately left
out of the migrated schema rather than added as empty, unused tables, to avoid a half-finished
migration with no corresponding application logic.
