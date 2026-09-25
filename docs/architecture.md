# Architecture

> Status: **scaffolded** (TIN-7). The layout below reflects the repo. Rows marked "planned" don't exist yet. Update this file whenever a decision below is made.

## Package shape

One npm package holds every ContactWise node and a **single shared credential type**. Verification allows one third-party service per package; SMS, the Trigger and WhatsApp all count as the same service (ContactWise).

| Artifact | Internal name | Phase |
|---|---|---|
| Credential `ContactWise API` | `contactWiseApi` | 1 |
| Node `ContactWise SMS` | `contactWiseSms` | 1 |
| Node `ContactWise SMS Trigger` | `contactWiseSmsTrigger` | Later (blocked: no webhook-registration API yet, TIN-26). Renamed from `ContactWise Trigger` on 2026-09-22, before anything was published |
| Node `ContactWise WhatsApp` | `contactWiseWhatsApp` | M3: Message → Send (TIN-39), Send Template (TIN-41), Send and Wait (TIN-43); Media → Upload and Delete (TIN-42). Media → Download to follow (TIN-55) |
| Node `ContactWise WhatsApp Trigger` | `contactWiseWhatsAppTrigger` | M3 (TIN-40; blocked by webhook subscriptions, TIN-34) |

Internal names (node `name`, credential `name`, parameter `name`s, option `value`s) are permanent once published, because saved workflows store them.

Layout (paths marked `planned` arrive with the issue in brackets):

```
credentials/ContactWiseApi.credentials.ts      # API Key, Tenant ID, Default Entity ID, WhatsApp Business Account ID; header auth; Test request
icons/contactwise.svg, contactwise.dark.svg    # brand Rising Mark: primary (light), inverted (dark); build copies to dist/icons
nodes/ContactWiseSms/ContactWiseSms.node.ts    # node description + execute(); + ContactWiseSms.node.json (codex)
nodes/ContactWiseSms/resources/sms/send.ts     # Send operation: parameters + send() per item
nodes/ContactWiseSms/shared/phone.ts           # normalizeIndianMobile(): common input forms → E.164 +91… (SMS only)
nodes/shared/transport.ts                      # all nodes: base URL, credential auth, X-CW-Source header, retry loop, sanitized NodeApiError
nodes/shared/errors.ts                         # interpretFailure(call, channel): ContactWise or Meta error → message, description, outcome (not-sent/unknown), retryable
nodes/shared/retry.ts                          # nextRetryDelayMs(): 429/503 only, max 3 attempts, max 60 s total wait
nodes/ContactWiseWhatsApp/ContactWiseWhatsApp.node.ts          # node description, methods, execute(); + .node.json (codex)
nodes/ContactWiseWhatsApp/resources/message/common.ts          # 'Phone Number' + 'Recipient Phone Number' for every sending operation; postMessage(), uploadBinaryMedia()
nodes/ContactWiseWhatsApp/resources/message/send.ts            # Message → Send: 7 types, binary upload then send by media ID
nodes/ContactWiseWhatsApp/resources/message/sendTemplate.ts    # Message → Send Template: 'Template' locator, header/body/button components
nodes/ContactWiseWhatsApp/resources/message/sendAndWait.ts     # Message → Send and Wait for Response: message + signed links, wait, resume webhook
nodes/ContactWiseWhatsApp/resources/message/contact.ts         # contact card parameters and Meta's `contacts` body
nodes/ContactWiseWhatsApp/resources/media/media.ts             # Media → Upload (multipart, returns the media ID) and Delete; Download is TIN-55
nodes/ContactWiseWhatsApp/methods/listSearch.ts                # resource locator lists: phone numbers; approved templates, paged by Meta's cursor
nodes/ContactWiseWhatsApp/shared/recipient.ts                  # normalizeRecipientPhoneNumber(): international, 8–15 digits, digits only
nodes/ContactWiseWhatsApp/shared/currencies.ts                 # active ISO 4217 codes, inlined (no currency-codes package)
nodes/ContactWiseWhatsApp/shared/responsePage.ts               # Send and Wait pages: confirm, form, recorded; escaping, form parsing, bot check
.agents/                                       # n8n's generic agent docs (scaffold-owned, don't edit)
.github/workflows/ci.yml, publish.yml          # lint + build; tag-triggered provenance publish
```

`package.json` has `"n8n": { "strict": true }`, which is n8n Cloud eligibility mode: the ESLint config must stay the n8n default (`n8n-node cloud-support` shows the status). Only `credentials/**`, `nodes/**` and `package.json` are compiled, so anything else (tests, fixtures) stays out of `dist/`.

Code every node uses (transport, error mapping, retry policy) lives in `nodes/shared/` (TIN-38). Code only one node uses stays in that node's own `shared/` folder. The transport grows only when a node needs a new capability, and it's tested through that node. So far it supports:
- requests with no body (GET)
- native `FormData` multipart bodies, which n8n-core's request helper sends as `multipart/form-data`
- the `ILoadOptionsFunctions` context, for dropdowns (TIN-39)

Query strings are built into the request path with `URLSearchParams` (TIN-41), so the transport has no query option. Still to come: binary responses (TIN-42) and the hook context (TIN-40).

`interpretFailure()` reads two error formats:
- **ContactWise:** `errors[]` with codes 1001 and 9000–9011, or problem+json.
- **Meta:** the Graph API envelope `{ error: { message, code, error_data.details, fbtrace_id } }`, which the WhatsApp gateway passes through unchanged. The `(#code)` prefix is stripped, `fbtrace_id` becomes the trace ID, and codes 131047, 130429, 131056, 131026 and 132xxx get specific fixes.

The status rules come before either format: 429/503 are retryable, and 5xx, 502/504 and timeouts are an unknown outcome that's never retried. The `channel` argument names what the call did, in every message:
- `sms` and `whatsapp` for sends, so WhatsApp errors never say "SMS"
- `whatsapp-upload` and `whatsapp-delete` for media (TIN-42), so an upload or delete never reads as "sent". For example: "The media file may already have been uploaded", "Nothing was deleted".

A binary media upload inside Message → Send uses `whatsapp-upload` for its upload step.

## Credential

| Field | Goes to |
|---|---|
| API Key (password) | `X-CW-Api-Key` header on every request |
| Tenant ID | URL path: `/v1/sms/{tenantId}/…` for SMS, `/v1/waba-direct/{tenantId}/…` for WhatsApp |
| Default Entity ID (optional) | Fallback for the SMS node's DLT Entity ID |
| WhatsApp Business Account ID (optional) | The tenant's one WhatsApp Business Account (TIN-37). The WhatsApp node reads it for `/{waba-id}/phone_numbers` and `/{waba-id}/message_templates`. There's no per-node override, and SMS never uses it |

Both nodes share this one credential. That's one of verification's rules: a package covers one service, and SMS and WhatsApp are both ContactWise.

The base URL is fixed at `https://api.contactwise.io` and is not a user field.

**Test button:** `GET /v1/account/{tenantId}/me`, which sends no message. `responseCode` rules turn a 401 into "The 'API Key' is invalid, or it doesn't belong to this tenant" and a 404 into an inactive-tenant message. n8n's linter requires a credential test (`credential-test-required`). The harness can't run n8n's credential tester, so the Test button is verified in real n8n (TIN-15).

## SMS Send: per-item flow

Each input item makes one API call; there's no batching in Phase 1.

1. Resolve the entity ID: the node field, else the credential default, else an item error. **No API call** is made in the error case.
2. Normalize `to` to E.164 (`normalizeIndianMobile`). An invalid number becomes an item error, **with no API call**. More than 10 'Metadata' pairs fails the same way.
3. `POST /v1/sms/{tenantId}/send` with `source: "n8n"` in the body, which the API records as the entry point so n8n traffic can be counted (TIN-6). The `X-CW-Source: n8n-nodes-contactwise/<package version>` header is still sent to identify the node version; the API doesn't read it today.
4. Map the response to an output item. On failure, `interpretFailure()` decides the wording and whether the SMS was definitely not sent. Only 429/503 are retried (`nextRetryDelayMs()`, waiting with n8n-workflow's `sleep`). Everything else throws a `NodeApiError` built from sanitized fields; the raw request error is never attached, because it carries the API key. Always keep `pairedItem`.

With Continue On Fail, a failed item's output is `{ error: <message>, errorDetails: { httpStatus, outcome, codes, messages, traceId, description } }`. `errorDetails` appears for API failures only; validation failures (invalid 'To', missing entity, too many metadata pairs) carry just `error`. `error` stays a string, following the n8n convention downstream nodes expect.

## Versioning

- Each node versions independently, starting at `1`. The npm package has its own semver.
- **Non-breaking** changes (a new optional parameter or option) use light versioning (`version: [1, 1.1]`), gating new fields with `displayOptions` on `@version`.
- **Breaking** changes get a new node version. Older versions must keep working for saved workflows.
- Full versioning (`VersionedNodeType` with `v1/`, `v2/` folders) is only available to programmatic-style nodes.

## Test seams

These are the agreed public boundaries tests are written at. They count as "pre-agreed seams" for the `tdd` skill, so don't re-ask for them. A new seam needs agreement first.

1. **Pure logic in `nodes/**/shared/`** (L1). Phone normalization (input string → canonical number or rejection), error mapping (HTTP status + body → user-facing error), retry decision (status + `Retry-After` + attempt → retry/wait or give up).
2. **Node execution** (L2). Workflow JSON with credentials goes in; output items or errors, plus the HTTP request the ContactWise API received, come out. HTTP is faked only at the network boundary (nock). Internal modules are never mocked.
3. **Dropdown lists** (L3, agreed 2026-09-25, TIN-39). A node's `methods.listSearch` method runs inside n8n-core's real `LoadOptionsContext`, the context n8n uses for a resource locator's 'From List' mode. Credentials are served from memory, and HTTP is faked with nock. The returned results, or the error, plus the HTTP request, come out.

4. **Webhooks** (L4, agreed 2026-09-25, TIN-43). A node's `webhook()` runs inside n8n-core's real `WebhookContext` with a hand-built fake request and response. That's how n8n calls a resume URL or a trigger's webhook. The value `webhook()` returns (resume data, the response for n8n to send) comes out, plus what the node wrote to the response itself (status, headers, HTML).

The expected values for seams 2 and 3 come from the contract docs (`docs/contactwise-sms-api.md`, `docs/contactwise-whatsapp-api.md`), never from the implementation.

### How tests are laid out

Tests live in a top-level `test/` folder, not next to the code. `tsconfig.json` compiles all of `nodes/**` into `dist/`, so tests there would ship in the package.

| Path | What it is |
|---|---|
| `test/setup.ts` | Closes the network before every test (`nock.disableNetConnect()`) |
| `test/harness/run-node.ts` | `runNode({ node, parameters, credentialTypes, credentials, input, inputItems, continueOnFail })` runs one node through n8n-core's `WorkflowExecute` and returns `{ items, error, run }`. `inputItems` passes full items, e.g. with binary data. `createTestWorkflow()` is the setup shared with L3 |
| `test/harness/run-webhook.ts` | `runWebhook({ node, parameters, method, query, body, headers })` runs `webhook()` in n8n-core's `WebhookContext` (seam L4) and returns `{ result, response }` |
| `test/harness/run-list-search.ts` | `runListSearch({ node, method, parameter, credentialTypes, credentials })` runs a list-search method in n8n-core's `LoadOptionsContext` (seam L3) |
| `test/harness/credentials-helper.ts` | Serves credentials from memory and applies `authenticate` (function or generic `={{$credentials.x}}`) |
| `test/harness/probe-node.ts` | Test-only node and credential that prove the harness itself |
| `test/fixtures/contactwise-api.ts` | `interceptSend(sendScenarios.x())`: a fake API with one scenario per error-table row. It records each request body and headers. |
| `test/fixtures/whatsapp-api.ts` | `interceptGateway(method, graphPath, whatsAppScenarios.x())`: a fake WhatsApp gateway (`/v1/waba-direct/{tenantId}/…`) with Meta-shaped responses and errors. It records each request body (multipart as raw text) and headers |

Harness facts found in the spike (2026-09-22):
- `vitest.config.mjs` aliases `n8n-workflow` to its **CommonJS** build. n8n loads community nodes with `require()`, so node code and n8n-core must share one n8n-workflow instance. With two copies, `error instanceof NodeApiError` is false for errors n8n-core creates. A harness test guards this.
- `npm run lint:fix` can't keep node properties it doesn't understand. When it reorders `fixedCollection` values, it drops `displayOptions`, `typeOptions` and references to shared `values` arrays (found on TIN-41, 2026-09-25). Reorder those by hand instead.
- n8n's defaults are wrong for SMS and must be overridden by our error mapping. A 500 surfaces as "The service was not able to process your request". A timeout says "consider setting the 'Retry on Fail' option", but retrying an SMS after a timeout can send it twice.
- `nock.replyWithError` needs an `Error` instance. A plain object makes the request hang.

## Decisions

| Topic | Status | Notes |
|---|---|---|
| Node style for `ContactWise SMS` | **Programmatic** (2026-09-22) | Needed for selective retry (429/503 only, honouring `Retry-After`) and direct unit testing of `execute()`, and it keeps full versioning available. The Trigger must be programmatic anyway. Trade-off accepted: more code than declarative, which n8n calls the faster route to approval. |
| Node style for `ContactWise WhatsApp` and its trigger | **Programmatic** (TIN-30, 2026-09-22) | Same reasons as SMS: selective retry and full versioning. Trigger nodes must be programmatic anyway. |
| WhatsApp API contract | **`docs/contactwise-whatsapp-api.md`** (TIN-37, 2026-09-25) | The gateway is a transparent proxy over Meta's Graph API v23.0 at `/v1/waba-direct/{tenantId}/{**catch-all}`. Request, response and error shapes are Meta's. |
| WhatsApp Send and Wait | **Rebuilt on `n8n-workflow` primitives** (TIN-30, 2026-09-22) | A community node can't import nodes-base's `sendAndWait` helpers. The rebuild uses `getSignedResumeUrl`, `putExecutionToWait`, `WAIT_INDEFINITELY` and `SEND_AND_WAIT_OPERATION`. |
| Send and Wait response pages | **The node serves its own pages** (TIN-43 spike, 2026-09-25) | A webhook can call n8n's `form-trigger` view, but its data comes from nodes-base helpers a community node can't import, and the sandboxing CSP header comes from `n8n-core`. So `shared/responsePage.ts` renders self-contained pages: HTML-escaped, with no JavaScript or external assets, served with a strict CSP. Custom Form has text, textarea, number, email, date, dropdown and checkbox fields, with no file uploads. |
| Answering a Send and Wait link | **GET shows, POST records** (TIN-43, 2026-09-25) | Opening a link only shows a page. The answer is recorded, and the workflow resumed, only when the page's form is submitted, so link previews (WhatsApp, Slack, Teams) can't approve anything. A POST from a known bot user agent is ignored too. This costs the recipient one extra tap compared with the official node. |
| Test depth | **Vitest, L1 + L2** (2026-09-22) | L1: unit tests of pure logic (normalization, error mapping, retry decisions). L2: the node executed through `n8n-core`'s execution engine, with HTTP intercepted by nock. No automated real-n8n E2E; the UI check is manual via `npm run dev` / `dev:docker`. Real-API checks are manual on the test tenant (TIN-15). |
| L2 spike outcome | **Kept** (TIN-19, 2026-09-22) | `WorkflowExecute`, `ExecutionLifecycleHooks` and `Credentials` are public `n8n-core` exports, so there are no deep imports into its internals. Node and credential classes are registered directly (no build needed). `n8n-core` 2.40.3 and `n8n-workflow` 2.40.1 are pinned devDependencies that must move together. |
| Agent guardrails | **Block publishing, block runtime deps** (2026-09-22) | Enforced by Claude Code hooks. CI also checks that `dependencies` is empty. |
| Harness skills | **tdd, vitest, `/verify`, copy-review subagent** (2026-09-22) | Marketplace: `mattpocock/skills@tdd`, `antfu/skills@vitest`, installed at project level and committed so every contributor gets the same set. Project-authored: the `/verify` gate and a reviewer for node copy against `docs/n8n-guidelines.md`. |
| Coverage gate | **90% on logic modules** (2026-09-22) | Enforced in CI on `nodes/**/shared/*` (normalization, error mapping, retry policy, transport). Parameter-description files are excluded. |
| npm package name | **`@contactwise/n8n-nodes-contactwise`** (TIN-1, 2026-09-22) | Published under the ContactWise npm org, so the company owns it rather than a personal account, with the source in the public `contactwise-oss` GitHub org (moved from `ContactWise` on 2026-09-23 for an open-source home and because Actions on the `ContactWise` org was billing-locked; TIN-45). `repository.url` must match the repo that publishes, or npm rejects the provenance statement. `publishConfig.access` is `public` because scoped packages default to restricted. The GitHub repo keeps the unscoped name, and the `X-CW-Source` header keeps `n8n-nodes-contactwise/<version>` (TIN-6). |
