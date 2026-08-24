# Billing

## The exact formula

```text
monthly_total_usd = 10
                   + max(0, active_branch_count - 1) * 5
                   + max(0, billable_user_count - 1) * 2
                   + selected_optional_add_ons
```

Implemented once, in integer USD cents, in `packages/domain/src/billing.ts`'s
`calculateMonthlyBilling` — every other layer (the `/billing/preview` API endpoint, the
`BillingService.recomputeSubscriptionItems` that keeps `SubscriptionItem` rows in sync,
`OnboardingService`'s initial subscription creation) calls this one function rather than
re-implementing the arithmetic. It's covered by unit tests in
`packages/domain/src/__tests__/billing.test.ts` (including the exact three acceptance-test
scenarios below) and by end-to-end integration tests against a real database in
`apps/api/test/integration/billing-acceptance.spec.ts`.

Defaults (also the seeded `PricingCatalogItem` rows — see "Versioned pricing catalog" below):

| Item                                          | Key            | Default price |
| --------------------------------------------- | -------------- | ------------- |
| Base subscription (1 branch, 1 user included) | `base`         | $10.00/mo     |
| Each additional branch                        | `extra_branch` | $5.00/mo      |
| Each additional user                          | `extra_user`   | $2.00/mo      |

## Why integer cents, not floating point

`calculateMonthlyBilling` and `packages/domain/src/money.ts`'s `Money` class both work in integer
minor units (cents) or `decimal.js`-backed arbitrary precision — never a raw JS `number` for a
dollar amount. Floating point drift is exactly the kind of bug that's invisible in a demo and
devastating at scale (thousands of transactions slowly drifting a tenant's stated balance away
from their actual one). `Money` throws on cross-currency arithmetic and rounds explicitly
(`ROUND_HALF_UP`) rather than implicitly.

## What counts toward the formula

- **`active_branch_count`** = `Branch` rows for the tenant with `isActive: true`. The tenant's
  first branch is created with `isBillable: false` during onboarding (it's the one included in
  the base $10), but every branch — including the first — counts toward `active_branch_count`;
  `isBillable` only matters if a future per-branch billing distinction is needed. Archiving a
  branch (`PATCH /branches/:id/archive`) sets `isActive: false` and immediately triggers a
  recompute.
- **`billable_user_count`** = `Membership` rows for the tenant with `status: ACTIVE` and
  `isBillableUser: true`. A suspended user (`status: SUSPENDED`) keeps their audit attribution
  (their `actorUserId` still shows up in historical `AuditEvent` rows) but stops counting here and
  can't sign in.

## Server-side entitlements only

The client never decides what's billable. `BillingService.previewBilling` recomputes
`active_branch_count`/`billable_user_count` from the database on every call — it's not a cached
client-supplied number. The web app's "add a branch" / "invite a user" flows call
`POST /billing/preview` to show the price **before** the billable action is confirmed (spec §4.4's
"transparent live price preview"), then the actual `POST /branches` or invite-accept endpoint
recomputes for real server-side regardless of what the preview showed.

## Concurrency safety

`BillingService.recomputeSubscriptionItems` runs the branch/user count query and the
`SubscriptionItem` upserts inside one Postgres transaction; concurrent callers serialize on the
`SubscriptionItem` unique-constraint row locks rather than racing to read-then-write stale counts.
`apps/api/test/integration/billing-acceptance.spec.ts`'s acceptance test #4 fires five concurrent
`POST /branches` requests at the same tenant and asserts the resulting charge increased by exactly
`5 × $5.00` — not more, not less, and no duplicate `SubscriptionItem` rows.

## Versioned pricing catalog

`PricingCatalogItem` rows (seeded by `packages/database/prisma/seed.ts`) are the actual source for
the base/branch/user unit prices — `calculateMonthlyBilling`'s hard-coded defaults
(`DEFAULT_BASE_PRICE_USD_CENTS` etc.) are only a fallback if the catalog is unexpectedly empty
(e.g., a fresh database before seeding). A platform admin can update prices
(`PATCH /admin/pricing-catalog/:id`) or add new optional add-ons
(`POST /admin/pricing-catalog/add-ons`) without a code deploy — see `apps/api/src/admin`. Every
such change is audited (`admin.pricing_catalog_updated` / `admin.pricing_addon_created`).

## Stripe integration

`BillingProvider` (`apps/api/src/billing/stripe/billing-provider.interface.ts`) is the typed
boundary. Two implementations:

- `StripeBillingProvider` — the real Stripe SDK, used automatically when `STRIPE_SECRET_KEY` is
  set. Creates customers/subscriptions, updates subscription item quantities, verifies webhook
  signatures (`stripe.webhooks.constructEvent`), and maps Stripe subscription statuses onto the
  local `SubscriptionStatus` enum.
- `NullBillingProvider` — used when no Stripe key is configured (the default in this
  environment, since no live credentials are available). Subscription state is tracked entirely in
  the local database so onboarding and the entitlement engine work end to end without a payment
  processor, but it is honest about not being connected: `BillingProvider.name` is `'none'`, and
  nothing in the codebase should present a `NullBillingProvider`-backed subscription as an actual
  successful charge — it's a trial/unbilled state.

`apps/api/src/billing/webhooks/billing-webhook.controller.ts` is idempotent: each processed
Stripe event is recorded in `BillingEvent` keyed by `stripeEventId` (a unique constraint), so a
replayed webhook delivery is a harmless no-op rather than a double-applied state change.

## What's not implemented yet

- Coupons, tax calculation, and annual billing are modeled for in the schema/interface shape but
  not wired up.
- Failed-payment dunning/recovery flows beyond marking the subscription `PAST_DUE` on
  `invoice.payment_failed`.
- Owner-facing invoice history / billing portal UI (the API has the data; no web screen for it
  yet beyond the price preview already built into onboarding).
