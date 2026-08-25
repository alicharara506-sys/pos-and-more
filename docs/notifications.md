# Notifications: email, SMS, and low-stock alerts

**Status: implemented for console (dev) delivery; real providers (Resend, Twilio) are wired with
genuine SDK/API code but unverified against a live account** — this environment has no
`RESEND_API_KEY` or Twilio credentials. See "What's honestly verified" below for exactly what that
means in practice.

## Typed provider boundary

`packages/notifications` defines `EmailAdapter` and `SmsAdapter` interfaces — `send()` in, a
`{ delivered, provider, providerMessageId? }` result out. Nothing else in the codebase imports a
concrete provider SDK directly; every caller talks to the interface.

- `ConsoleEmailAdapter` / `ConsoleSmsAdapter` — the default (`EMAIL_PROVIDER=console`,
  `SMS_PROVIDER=none`). Logs what would be sent and returns `delivered: false`. This is an honest
  result, not a placeholder to swap out later — callers must check `delivered` before telling a
  user "sent".
- `ResendEmailAdapter` — a real single-call REST integration
  (`POST https://api.resend.com/emails`), used when `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`
  is set.
- `TwilioSmsAdapter` — a real single-call REST integration (Twilio's Messages API, Basic auth,
  form-encoded body), used when `SMS_PROVIDER=twilio` and `TWILIO_ACCOUNT_SID`/
  `TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` are all set.
- `resolveEmailAdapter(env)` / `resolveSmsAdapter(env)` — the one place that maps the configured
  provider name to a concrete adapter (`packages/notifications/src/resolve.ts`), mirroring
  `apps/api/src/integrations/connector-registry.ts`'s shape for the same reason: adding a provider
  means adding a case here, never touching a call site. `EMAIL_PROVIDER=sendgrid` is accepted by
  config validation but throws an explicit "not implemented" error rather than silently no-op —
  same posture as the Shopify connector in the commerce integration hub.

## Two delivery paths

1. **Outbox-driven, automatic** (`apps/worker/src/queues/notifications.queue.ts`): `tenant.created`
   (welcome email), `invitation.created` (invite link), `invoice.issued` / `invoice.paid` (emailed
   to the customer with the public view link), `inventory.low_stock` (emailed to every tenant
   owner). These fire from the transactional outbox — never inside the request-handling DB
   transaction that created the underlying row (`docs/architecture.md`'s outbox pattern). Each
   handler fetches the data it needs via Prisma and skips honestly (no fabricated send) when
   there's nothing to send to, e.g. an invoice whose customer has no email on file.
2. **On-demand, synchronous** (`InvoicesService.send()`, `POST /invoices/:id/send`): a cashier
   explicitly clicking "Email" or "SMS" on an invoice. This calls the adapter directly rather than
   queuing it, because the caller wants to know right now whether it actually went out — the
   response is the adapter's real `{ delivered, provider }`, not an assumed success.

## Low-stock alerts

`InventoryService.recordMovement` — the single choke point every stock change goes through
(adjustments, transfers, sales, refunds) — computes the stock status before and after each
movement using the same `computeStockStatus()` the red/yellow/green badges use. An
`inventory.low_stock` outbox event fires only on the transition **into** red, never on every
movement while a variant is already red — otherwise every subsequent sale of an out-of-stock item
would re-alert. See `apps/api/test/integration/low-stock-alert.spec.ts` for the crossing behavior
verified against a real Postgres-backed API (opening stock → no alert, drop below reorder point →
one alert, another movement while still red → no second alert, restock above then back below →
alerts again).

## What's honestly verified

- The `delivered: false` / `provider: 'console'` honest-failure path is exercised in every
  automated test that touches a notification (unit tests in `packages/notifications` and
  `apps/worker`, integration tests in `apps/api`) — this is the actual behavior of a default
  install with no provider keys configured.
- `ResendEmailAdapter` and `TwilioSmsAdapter` are unit tested against a fake `fetch` that asserts
  the exact request shape (URL, auth header, body) each real API expects — this confirms the
  integration code is correct REST usage, not that a real email/SMS has ever been delivered by
  this codebase. No live Resend or Twilio account was available to verify an actual send.
- The full outbox → worker → adapter wiring was exercised live: creating a tenant, inviting a
  user, issuing and paying an invoice, and crossing a variant into low stock all produced a
  `[console-email] to=... subject="..."` log line from the real code path (not a bespoke
  `console.log` per event), confirming the plumbing is genuinely connected end to end.

## What's honestly not done

- **No SendGrid adapter** despite `EMAIL_PROVIDER=sendgrid` being a valid config value — it throws
  rather than silently no-op.
- **No push notifications or in-app notification center** — email/SMS only.
- **No user-configurable notification preferences** (e.g. opting a tenant owner out of low-stock
  alerts, or choosing which events to receive) — every tenant owner gets every low-stock alert.
- **`sale.created`/`sale.refunded` outbox events stay internal-only logs**, not customer emails —
  there's no reliable opt-in recipient for a POS sale receipt without a dedicated "email my
  receipt" flow at checkout, which is unbuilt.
