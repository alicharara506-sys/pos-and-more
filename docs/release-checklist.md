# Release readiness

A single, honest view across every phase: what's genuinely built and tested, and exactly what
stands between this repository and a real production deployment. Each per-phase doc has the full
detail; this is the index, not a duplicate.

## What's built (phases 0–7)

| Area                                                                           | Status                                                                                   | Detail                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Foundation (multi-tenant model, auth, RBAC, billing formula)                   | Implemented, tested                                                                      | `docs/architecture.md`, `docs/security.md`, `docs/billing.md` |
| Core commerce (catalog, inventory ledger, sales, invoices, expenses)           | Implemented, tested                                                                      | `docs/data-model.md`                                          |
| Offline-first mobile POS                                                       | Implemented; mobile app unit-tested and bundle-verified, never run on a device/simulator | `docs/offline-sync.md`                                        |
| E-commerce integration hub (WooCommerce)                                       | Implemented, tested                                                                      | `docs/integrations.md`                                        |
| Notifications (email/SMS), low-stock alerts, invoice send, QR codes, reporting | Implemented, tested                                                                      | `docs/notifications.md`                                       |
| AI sales assistant                                                             | Implemented; orchestration tested against a fake transport, never a live model           | `docs/ai-assistant.md`                                        |

## What "tested" means here

Every phase above has real unit and/or integration test coverage that runs against a genuine
Postgres instance (never mocks for the database layer) — see each doc's own "what's verified"
section for specifics. The one recurring, explicitly-labeled gap across every third-party
integration (Google/Apple OAuth, Stripe, Resend, Twilio, Anthropic, WooCommerce) is: **this
environment has no live credentials for any of them**, so every adapter's request-shape is
verified against a fake transport or a real fixture server, never against the actual third-party
endpoint. That is the single most important thing to close before a real launch — see "Before
processing real traffic" below.

## What hardening found and fixed (phase 8)

- **CI was silently broken for two full phases.** `packages/integrations` (phase 5) and
  `packages/notifications` (phase 6) were never added to `.github/workflows/ci.yml`'s
  shared-package build steps, even though `apps/api`/`apps/worker` depend on them at runtime. Every
  push since phase 5 would have failed CI's typecheck/test/build jobs from a clean checkout — this
  went undetected because local verification always ran through Turbo's own dependency graph
  (which builds transitively), while CI's jobs call `pnpm --filter <pkg> <script>` directly,
  bypassing that graph. Reproduced against a wiped `dist/` state to confirm the failure, then fixed
  and re-verified the same way. See git history for the fix.
- **A real cross-tenant data-integrity gap** in manual inventory adjustments and stock transfers —
  see `docs/security.md`'s "Tenant isolation: a real gap found and fixed during hardening" section.
- Added stricter per-route rate limits on the two new endpoints that can trigger a real, billed
  external API call (`POST /assistant/ask`, `POST /invoices/:id/send`).
- Confirmed no third-party API key or session secret is ever logged, returned in a response body,
  or written into an outbox payload across the phase 5–7 code (email/SMS/AI adapters, commerce
  connections, QR generation).

## Before processing real traffic

None of this is done, and none of it is implied to be done by anything above:

1. **Configure and test every third-party provider against a real account** — Google/Apple OAuth
   consent screens, a real Stripe account with the pricing catalog's Price IDs, Resend or a real
   email provider, Twilio, and (if the assistant ships) an Anthropic API key with usage limits
   configured. Every adapter already exists; none has been exercised against the real service.
2. **Wire dependency/secret scanning into CI** (`npm audit`, Snyk/Trustworthy, Gitleaks or
   equivalent) — not present today (`docs/security.md`).
3. **Rotate every secret used during development** (`AUTH_JWT_SECRET`, `AUTH_ENCRYPTION_KEY`,
   `PLATFORM_ADMIN_JWT_SECRET`) before go-live; nothing in `.env.example` is safe to reuse.
4. **Load-test the POS sale path and the outbox/worker drain** — no load testing has been done at
   any phase; the decimal-safe, idempotent design is correctness-tested, not throughput-tested.
5. **Stand up real infrastructure** for Postgres (with disk-level encryption and backups), Redis,
   and object storage — this repo assumes local/dev instances throughout.
6. **Build the GDPR/CCPA data export/deletion endpoints** the schema supports but doesn't expose
   yet (`docs/security.md`).
7. **Decide on and build recurring/scheduled report delivery** if wanted — reports are on-demand
   only today (`docs/notifications.md`).

## Explicitly out of scope for this codebase as it stands

- Shopify and other e-commerce platforms beyond WooCommerce (`docs/integrations.md`).
- Order→sale materialization and inbound inventory sync from a connected store
  (`docs/integrations.md`).
- AI-assistant write actions, persisted conversation history, and streaming (`docs/ai-assistant.md`).
- A local/self-hosted AI model provider (`AI_PROVIDER=local`) (`docs/ai-assistant.md`).
