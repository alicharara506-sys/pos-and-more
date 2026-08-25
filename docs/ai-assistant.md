# AI sales assistant

**Status: implemented, unverified against a live model.** The full request/response plumbing —
tool-use loop, tenant-scoped tool execution, the honest "not configured" path — is real code,
covered by unit and integration tests. This environment has no `ANTHROPIC_API_KEY`, so no real
model has ever answered a question through this code path; only the unconfigured fallback has been
exercised end to end.

## Typed provider boundary

`apps/api/src/assistant/ai-adapter.interface.ts` defines `AiAssistantAdapter` — `ask()` in,
`{ answer, toolCalls }` out — mirroring `EmailAdapter`/`SmsAdapter`/`CommerceConnector`'s shape
(section 1.2: keep external providers behind typed adapters).

- `NullAiAssistantAdapter` — used when `AI_PROVIDER=none` (the default; no key in this
  environment). `isConfigured()` returns `false`; `AssistantService` checks that before ever
  calling `ask()` and returns an honest `503 Service Unavailable` with a clear explanation, never a
  fabricated answer.
- `AnthropicAiAssistantAdapter` — a real integration via the official `@anthropic-ai/sdk` (per the
  project's Claude API usage guidance: the official SDK, never raw HTTP, when one exists for the
  language), used when `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` is set. Runs a manual
  tool-use loop (`client.messages.create()`, not the beta tool runner) against `claude-opus-5`, so
  it can sit behind our own provider-agnostic interface instead of a provider-specific runner.
- `AI_PROVIDER=local` is accepted by config validation but throws an explicit "not implemented"
  error — same posture as the `sendgrid` email provider and the Shopify commerce connector: an
  unimplemented option says so, it never silently no-ops.

## The tool surface

The assistant's entire read-only window onto tenant data is four fixed tools
(`apps/api/src/assistant/tools.ts`), each backed by an existing `ReportsService` method:

- `get_sales_summary(from, to, groupBy)` → `ReportsService.getSalesByPeriod`
- `get_low_stock_items()` → `ReportsService.getLowStockItems` (new — the dashboard previously only
  exposed low-stock *counts*; this returns the actual list)
- `get_inventory_valuation()` → `ReportsService.getInventoryValuation`
- `get_dashboard_summary()` → `ReportsService.getDashboard`

The model can only ask questions this codebase already knows how to answer safely and
tenant-scoped — there is no raw database or SQL access, and every tool call is bound to the
requesting tenant's ID before it ever reaches the adapter.

## Request flow

`POST /assistant/ask` (`RbacGuard`-gated on `reports.view`, same permission as the Reports page)
takes `{ question, conversation }` — `conversation` is the prior turns of a multi-turn chat, sent
by the client and never persisted server-side (see "What's honestly not done"). `AssistantService`
appends the new question, hands the fixed tool list and a tenant-bound executor to the adapter, and
returns the model's final text answer plus which tools it called (for observability — not shown to
the end user today).

`GET /assistant/status` returns `{ configured: boolean }` so `apps/web`'s Assistant page can show
an honest banner up front rather than let every question fail before explaining why.

## What's verified

- The manual tool-use loop, multi-round tool execution, and error-as-tool-result handling are unit
  tested against a fake Anthropic client that asserts the exact request shape each round — this
  confirms the orchestration logic is correct, not that a real model has ever produced these
  responses.
- The tool executor's tenant-scoping and input validation (rejecting an invalid date, rejecting an
  unknown tool name) are unit tested directly.
- The honest `configured: false` / `503 not configured` path is integration tested against a real,
  running API — this is the actual behavior of a default install with no `ANTHROPIC_API_KEY`,
  confirmed live in a browser: the banner renders, and submitting a question surfaces the real 503
  error rather than a fabricated response.

## What's honestly not done

- **No live model verification.** Every Anthropic API request shape has been checked against a
  fake transport, never against the real `api.anthropic.com` endpoint — this environment has no
  key to test with.
- **No persisted conversation history.** Multi-turn context lives only in the browser tab's React
  state; refreshing the page loses it. A dedicated `AssistantConversation`/`AssistantMessage` data
  model is unbuilt.
- **No streaming.** `ask()` waits for the full response rather than streaming tokens — acceptable
  for short business-Q&A answers, but a longer response would feel slow.
- **No write actions.** The assistant can only read/report — it cannot create a sale, adjust
  inventory, or send an invoice on the user's behalf, even though those are real endpoints
  elsewhere in the API. Expanding its tool set to actions is a deliberate scope boundary, not an
  oversight — a model-initiated write needs its own confirmation/audit story this phase didn't
  build.
- **`AI_PROVIDER=local`** (a self-hosted model endpoint via `AI_LOCAL_MODEL_ENDPOINT`) has no
  adapter implementation.
