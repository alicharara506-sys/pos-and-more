# Security

## Threat model summary

SalesMaster Pro is multi-tenant SaaS handling payment records, customer PII, and business
financials. The primary threats this design addresses:

1. **Cross-tenant data access** — a compromised or malicious tenant user reading/writing another
   tenant's data. Mitigated structurally (see `docs/data-model.md`'s tenant-isolation strategy)
   and covered by automated negative tests
   (`apps/api/test/integration/tenant-isolation.spec.ts`).
2. **Session/credential compromise** — stolen session tokens, weak passwords, replayed OAuth
   callbacks.
3. **Provider secret leakage** — OAuth refresh tokens, Stripe keys, future commerce-connector
   tokens.
4. **Platform-admin privilege escalation** — a tenant user reaching platform-admin capability.

## Authentication

### Email/password

- Argon2id hashing (`apps/api/src/auth/password.service.ts`) — OWASP's current recommendation,
  not bcrypt/PBKDF2.
- Email verification via a short-lived (24h), single-purpose signed JWT
  (`purpose: 'email_verification'`) — see "One-time tokens" below.
- Password reset via a 30-minute single-purpose token; resetting a password revokes **all** of
  that user's active sessions (`AuthService.resetPassword`), since a password reset is a
  privilege-relevant event.

### Magic link

15-minute (configurable) single-purpose token, delivered by email. Consuming it creates the user
if they don't exist and marks their email verified (clicking a link sent to that address is proof
of ownership) — see `AuthService.consumeMagicLink`.

### Google / Apple OAuth

Both use Authorization Code Flow with PKCE, `state`, and (Apple/Google ID token) `nonce`, exactly
per spec §3.2:

- The PKCE `code_verifier` + `state` + `nonce` for an in-flight flow live in a short-lived,
  **encrypted**, httpOnly cookie (`OAuthHandshakeService`) — not server-side session storage, since
  the value is read exactly once, seconds later, by the same browser.
- ID tokens are verified against the provider's live JWKS (`jose`'s `createRemoteJWKSet`), checking
  issuer, audience, signature, expiry, and the `nonce` echoed back matches what was issued.
- The durable identity key is the provider's `sub` claim (`IdentityProviderAccount.providerSubject`
  under a `@@unique([provider, providerSubject])` constraint) — **never** the provider-supplied
  email. Apple's private-relay email addresses are recorded with `isPrivateRelayEmail: true` and
  never treated specially beyond that flag.
- **Account linking is intentionally conservative**: a new OAuth identity is only attached to an
  _existing_ `User` row if the provider says the email is verified **and** that existing user's own
  `emailVerifiedAt` is already set. Two unverified email strings matching is never sufficient to
  merge accounts (`AuthService.linkOrCreateUserForIdentity`) — this is exactly the spec §3.2
  requirement and is the one piece of auth logic most worth reading directly if reviewing this.
- Apple's client secret is a short-lived ES256 JWT signed with the app's private key per request
  (`AppleOAuthService.buildClientSecret`), not a static secret string, matching Apple's actual
  requirement.

### MFA

TOTP (RFC 6238) via `otplib`, plus 10 single-use recovery codes. Recovery codes are **hashed**
(SHA-256), not reversibly encrypted, the same posture as passwords — they're a credential, not
data that needs to be read back.

### Sessions (not raw JWT access tokens)

Logged-in access uses an **opaque, revocable, DB-backed session token** (`Session.tokenHash`,
sha256 of a random 32-byte value), not a bare JWT access token. This is deliberate: a JWT can't be
revoked before its own expiry without a blocklist, which conflicts with the spec's explicit
"session/device management and remote sign-out" requirement. `POST /auth/logout` revokes the
current session; `POST /auth/sessions/revoke-all` revokes every other session for the user
(remote sign-out); a password reset revokes all sessions.

One-time-purpose tokens (magic link, password reset, email verification, MFA challenge) are the
opposite tradeoff on purpose: short-lived, stateless, signed JWTs (`TokenService`), because they're
single-use-by-convention and don't need a revocation story beyond their short TTL. A malformed,
expired, or wrong-purpose token always resolves to a clean `401 Unauthorized`
(`TokenService.verifyOneTimeToken`), never a raw 500.

## Authorization (RBAC)

- Five system roles (owner, manager, cashier, inventory_clerk, viewer) with a default permission
  grant each (`packages/domain/src/permissions.ts`), seeded once as shared `Role` templates
  (`tenantId: null`).
- `RbacGuard` checks the caller's resolved `Membership → Role → RolePermission` set against
  `@RequirePermissions(...)` on each route.
- **Platform admin is a separate authorization path**, not a tenant role: `PlatformAdminGuard`
  checks only `User.isPlatformAdmin`, is never combined with `TenantGuard`/`RbacGuard`, and every
  mutation on that surface is audited (`apps/api/src/admin`).
- Per-membership `branchScope` (empty = unrestricted) lets an owner restrict a manager to specific
  branches; the granular per-owner permission overrides described in spec §2 (restricting refunds,
  discounts, cost-price visibility, etc. per membership) are supported by the schema
  (`RolePermission` is per-role, and a future per-membership override table would extend this
  cleanly) but not yet exposed in the API surface.

## Encryption at rest

- OAuth refresh/access tokens (`IdentityProviderAccount.*TokenEncrypted`) and TOTP secrets/recovery
  codes are AES-256-GCM encrypted with a random IV per value
  (`apps/api/src/common/crypto/encryption.service.ts`), keyed from `AUTH_ENCRYPTION_KEY`.
- Session tokens and recovery codes are hashed (SHA-256), not encrypted — they're credentials that
  only ever need comparison, never reading back.
- Postgres itself should run with disk-level encryption in any real deployment (a platform/infra
  concern, not application code).

## Rate limiting

Global default (100 req/min/IP via `@nestjs/throttler`) plus tighter per-route limits on
`register`, `login`, `password/forgot`, `password/reset`, `magic-link/*`, and `mfa/verify`
(5–10 req/min) — the endpoints spec §3.2 explicitly calls out for abuse protection.

## What is honestly not done

- No dependency/secret scanning is wired into CI yet (`.github/workflows/ci.yml` runs
  lint/typecheck/tests/build/migration-check, not a security scanner) — add e.g. `npm audit` /
  Trustworthy/Snyk/Gitleaks as a follow-up.
- No SOC 2 process exists; nothing in this codebase claims SOC 2 readiness beyond "the technical
  controls above are a reasonable starting point."
- GDPR/CCPA data export/deletion workflows are not implemented — the schema's tenant/user shape
  supports building them (everything is keyed and queryable by `tenantId`/`userId`), but no
  endpoint exists yet.
- Malware scanning on uploads doesn't apply yet since no file upload endpoint exists (product
  images, receipts, etc. accept a URL today, not a direct upload).
