# Architecture

> Status: **scaffolded** (TIN-7). The layout below reflects the repo. Rows marked "planned" don't exist yet. Update this file whenever a decision below is made.

## Package shape

One npm package holds every ContactWise node and a **single shared credential type**. Verification allows one third-party service per package; SMS, the Trigger and WhatsApp all count as the same service (ContactWise).

| Artifact | Internal name | Phase |
|---|---|---|
| Credential `ContactWise API` | `contactWiseApi` | 1 |
| Node `ContactWise SMS` | `contactWiseSms` | 1 |
| Node `ContactWise SMS Trigger` | `contactWiseSmsTrigger` | Later (blocked: no webhook-registration API yet, TIN-26). Renamed from `ContactWise Trigger` on 2026-09-22, before anything was published |
| Node `ContactWise WhatsApp` | `contactWiseWhatsApp` | M3: Message → Send (TIN-39; Interactive from v1.1, TIN-61), Send Template (TIN-41), Send and Wait (TIN-43); Media → Upload and Delete (TIN-42), Download (TIN-55) |
| Node `ContactWise WhatsApp Trigger` | `contactWiseWhatsAppTrigger` | M3 (TIN-40): registers a ContactWise webhook subscription (TIN-34) on activation, verifies each signed delivery |

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
nodes/ContactWiseWhatsApp/resources/message/interactive.ts     # Message Type → Interactive (v1.1): reply buttons and lists, count checks, Meta's `interactive` body
nodes/ContactWiseWhatsApp/resources/media/media.ts             # Media → Upload (multipart, returns the media ID), Delete, and Download (binary, via the gateway's streaming route)
nodes/ContactWiseWhatsApp/methods/listSearch.ts                # resource locator lists: phone numbers; approved templates, paged by Meta's cursor
nodes/ContactWiseWhatsApp/shared/recipient.ts                  # normalizeRecipientPhoneNumber(): international, 8–15 digits, digits only
nodes/ContactWiseWhatsApp/shared/currencies.ts                 # active ISO 4217 codes, inlined (no currency-codes package)
nodes/ContactWiseWhatsApp/shared/responsePage.ts               # Send and Wait pages: confirm, form, recorded; escaping, form parsing, bot check
nodes/ContactWiseWhatsAppTrigger/ContactWiseWhatsAppTrigger.node.ts  # trigger: webhookMethods (checkExists, create, delete) and webhook(); + .node.json (codex)
nodes/ContactWiseWhatsAppTrigger/shared/signature.ts            # verifyDelivery(): X-CW-Signature-256 over the raw body, 5-minute window, rotation
nodes/ContactWiseWhatsAppTrigger/shared/events.ts               # deliveryToItems(): one item per entry[].changes[], message status filter (v1: empty = all; v1.1: empty = none)
.agents/                                       # n8n's generic agent docs (scaffold-owned, don't edit)
.github/workflows/ci.yml, publish.yml          # lint + build; tag-triggered provenance publish
```

`package.json` has `"n8n": { "strict": true }`, which is n8n Cloud eligibility mode: the ESLint config must stay the n8n default (`n8n-node cloud-support` shows the status). Only `credentials/**`, `nodes/**` and `package.json` are compiled, so anything else (tests, fixtures) stays out of `dist/`.

Code every node uses (transport, error mapping, retry policy) lives in `nodes/shared/` (TIN-38). Code only one node uses stays in that node's own `shared/` folder. The transport grows only when a node needs a new capability, and it's tested through that node. So far it supports:
- requests with no body (GET)
- native `FormData` multipart bodies, which n8n-core's request helper sends as `multipart/form-data`
- the `ILoadOptionsFunctions` context, for dropdowns (TIN-39)
- binary responses: `contactWiseApiDownload()` returns the bytes and the headers (TIN-55). Error bodies then arrive as bytes too, so they're parsed as JSON before the error mapping sees them
- the `IHookFunctions` context, for a trigger's activation hooks (TIN-40)

Query strings are built into the request path with `URLSearchParams` (TIN-41), so the transport has no query option.

`interpretFailure()` reads two error formats:
- **ContactWise:** `errors[]` with codes 1001 and 9000–9011, or problem+json.
- **Meta:** the Graph API envelope `{ error: { message, code, error_data.details, fbtrace_id } }`, which the WhatsApp gateway passes through unchanged. The `(#code)` prefix is stripped, `fbtrace_id` becomes the trace ID, and codes 131047, 130429, 131056, 131026 and 132xxx get specific fixes.

The status rules come before either format: 429/503 are retryable, and 5xx, 502/504 and timeouts are an unknown outcome that's never retried. The `channel` argument names what the call did, in every message:
- `sms` and `whatsapp` for sends, so WhatsApp errors never say "SMS"
- `whatsapp-upload` and `whatsapp-delete` for media (TIN-42), so an upload or delete never reads as "sent". For example: "The media file may already have been uploaded", "Nothing was deleted".
- `whatsapp-download` for Media → Download (TIN-55). A download has no side effects, so the channel is marked read-only: 502, 504 and broken connections are retried like 429/503, a 404 says the media file wasn't found, and nothing says "may already have been". A 500 is still not retried.

- `whatsapp-webhook-list`, `whatsapp-webhook-create` and `whatsapp-webhook-delete` for the WhatsApp Trigger's subscription calls (TIN-40). These are marked `noRetry`: nothing is retried, not even a 429/503. n8n runs them on activation, so the user sees the error and activates again, and ContactWise asked for no client retries on these routes. A create that may have happened says so: a leftover subscription fails n8n's signature check and ContactWise disables it after 24 hours.

A binary media upload inside Message → Send uses `whatsapp-upload` for its upload step.

The gateway's own errors have the body `{ "error": "<message>" }` (TIN-33). When no other rule matches, that message is shown as "ContactWise rejected <the request>: <message>".

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
- Light versions so far: ContactWise WhatsApp Trigger `1.1` (TIN-60), which turns message status updates off by default, ContactWise WhatsApp Trigger `1.2` (TIN-66), which adds the parsed answers of a submitted Flow (`nfm_reply.response`) and has no new parameters, ContactWise WhatsApp `1.1` (TIN-61), which adds Message Type → Interactive, ContactWise WhatsApp `1.2` (TIN-62), which adds 'Specify Buttons' and 'Specify Rows' (**Using JSON**) so a workflow can pass buttons and list rows as data, and ContactWise WhatsApp `1.3` (TIN-63), which adds 'Interactive Type' → **Flow**. An option can't have its own `displayOptions`, so v1.1's 'Message Type' is a second `messageType` parameter with the extra option, shown for `@version` 1.1 and later, while v1 keeps the published list. The node reads `this.getNode().typeVersion` in `webhook()`, and the fields are gated with `'@version'` `displayOptions`. In v1.2 the fixed Buttons and Rows lists use `hide: { buttonsInputMode: ['json'] }` rather than `show`, so they stay visible in v1.1, which has no 'Specify' parameter. A hidden parameter's values are dropped before `execute()` runs. v1.3's 'Interactive Type' is likewise a second `interactiveType` parameter, shown for `@version` 1.3 and later, while v1.1 and v1.2 keep Buttons and List only. Loosening a published parameter needs no new version: TIN-67 dropped `noDataExpression` from 'Flow Action' and `required` from 'Screen' within v1.3, since every saved value stays valid. Don't gate fields with `displayOptions` on a parameter that can hold an expression: the backend treats an expression as matching (it keeps the fields), but the editor evaluates it, without item data, and may hide them. So 'Screen' and 'Screen Data (JSON)' show for every Flow, aren't `required`, and `execute()` checks them for Navigate only.

## Test seams

These are the agreed public boundaries tests are written at. They count as "pre-agreed seams" for the `tdd` skill, so don't re-ask for them. A new seam needs agreement first.

1. **Pure logic in `nodes/**/shared/`** (L1). Phone normalization (input string → canonical number or rejection), error mapping (HTTP status + body → user-facing error), retry decision (status + `Retry-After` + attempt → retry/wait or give up).
2. **Node execution** (L2). Workflow JSON with credentials goes in; output items or errors, plus the HTTP request the ContactWise API received, come out. HTTP is faked only at the network boundary (nock). Internal modules are never mocked.
3. **Dropdown lists** (L3, agreed 2026-09-25, TIN-39). A node's `methods.listSearch` method runs inside n8n-core's real `LoadOptionsContext`, the context n8n uses for a resource locator's 'From List' mode. Credentials are served from memory, and HTTP is faked with nock. The returned results, or the error, plus the HTTP request, come out.

4. **Webhooks** (L4, agreed 2026-09-25, TIN-43). A node's `webhook()` runs inside n8n-core's real `WebhookContext` with a hand-built fake request and response. That's how n8n calls a resume URL or a trigger's webhook. The value `webhook()` returns (resume data, the response for n8n to send) comes out, plus what the node wrote to the response itself (status, headers, HTML). The request can carry `rawBody`, the bytes n8n keeps on `req.rawBody`, and the node's static data (TIN-40).
5. **Trigger activation hooks** (L5, agreed 2026-09-28, TIN-40). One of a trigger's `webhookMethods.default` hooks (`checkExists`, `create`, `delete`) runs inside n8n-core's real `HookContext`, as n8n runs them on activation, deactivation and "Listen for test event". The node's static data goes in; the hook's result or error, the static data afterwards, and the HTTP requests (faked with nock) come out.

The expected values for seams 2 and 3 come from the contract docs (`docs/contactwise-sms-api.md`, `docs/contactwise-whatsapp-api.md`), never from the implementation.

### How tests are laid out

Tests live in a top-level `test/` folder, not next to the code. `tsconfig.json` compiles all of `nodes/**` into `dist/`, so tests there would ship in the package.

| Path | What it is |
|---|---|
| `test/setup.ts` | Closes the network before every test (`nock.disableNetConnect()`) |
| `test/harness/run-node.ts` | `runNode({ node, parameters, credentialTypes, credentials, input, inputItems, continueOnFail })` runs one node through n8n-core's `WorkflowExecute` and returns `{ items, error, run }`. `inputItems` passes full items, e.g. with binary data. `createTestWorkflow()` is the setup shared with L3 |
| `test/harness/run-webhook.ts` | `runWebhook({ node, parameters, method, query, body, rawBody, headers, staticData, typeVersion })` runs `webhook()` in n8n-core's `WebhookContext` (seam L4) and returns `{ result, response }` |
| `test/harness/run-hook.ts` | `runHook({ node, hook, parameters, staticData, isTest, workflowName })` runs a trigger's activation hook in n8n-core's `HookContext` (seam L5) and returns `{ result, error, staticData }`. The webhook URLs it builds are exported (`PRODUCTION_WEBHOOK_URL`, `TEST_WEBHOOK_URL`) |
| `test/harness/run-list-search.ts` | `runListSearch({ node, method, parameter, credentialTypes, credentials })` runs a list-search method in n8n-core's `LoadOptionsContext` (seam L3) |
| `test/harness/credentials-helper.ts` | Serves credentials from memory and applies `authenticate` (function or generic `={{$credentials.x}}`) |
| `test/harness/probe-node.ts` | Test-only node and credential that prove the harness itself |
| `test/fixtures/contactwise-api.ts` | `interceptSend(sendScenarios.x())`: a fake API with one scenario per error-table row. It records each request body and headers. |
| `test/fixtures/whatsapp-api.ts` | `interceptGateway(method, graphPath, whatsAppScenarios.x())`: a fake WhatsApp gateway (`/v1/waba-direct/{tenantId}/…`) with Meta-shaped responses and errors. It records each request body (multipart as raw text) and headers. `interceptWebhooks(method, subscriptionId, webhookScenarios.x())` fakes the subscription routes (`/v1/whatsapp/{tenantId}/webhooks`) |

Harness facts found in the spike (2026-09-22):
- `vitest.config.mjs` aliases `n8n-workflow` to its **CommonJS** build. n8n loads community nodes with `require()`, so node code and n8n-core must share one n8n-workflow instance. With two copies, `error instanceof NodeApiError` is false for errors n8n-core creates. A harness test guards this.
- `npm run lint:fix` can't keep node properties it doesn't understand. When it reorders `fixedCollection` values, it drops `displayOptions`, `typeOptions` and references to shared `values` arrays (found on TIN-41, 2026-09-25). Reorder those by hand instead.
- The lint rule `node-param-fixed-collection-type-unsorted-items` wants `fixedCollection` values in alphabetical order, which puts a selector such as Send Template's component **Type** below the fields it controls. TIN-56 kept Type first with an inline `eslint-disable-next-line`, but **n8n's package scan ignores inline lint exceptions** and failed 0.2.0 and 0.3.0 on it. Since TIN-59 (2026-09-28) the values are alphabetical, Type last, and node code has no inline lint exceptions: `npx eslint --no-inline-config nodes credentials` must pass. The ESLint config stays n8n's default.
- The scanner (`@n8n/scan-community-package`) **exits 0 even when it reports a failure**. `scripts/n8n-scan.sh` reads its output instead; the publish workflow runs it after every release (TIN-59).
- n8n's defaults are wrong for SMS and must be overridden by our error mapping. A 500 surfaces as "The service was not able to process your request". A timeout says "consider setting the 'Retry on Fail' option", but retrying an SMS after a timeout can send it twice.
- `nock.replyWithError` needs an `Error` instance. A plain object makes the request hang.

## Decisions

| Topic | Status | Notes |
|---|---|---|
| Node style for `ContactWise SMS` | **Programmatic** (2026-09-22) | Needed for selective retry (429/503 only, honouring `Retry-After`) and direct unit testing of `execute()`, and it keeps full versioning available. The Trigger must be programmatic anyway. Trade-off accepted: more code than declarative, which n8n calls the faster route to approval. |
| Node style for `ContactWise WhatsApp` and its trigger | **Programmatic** (TIN-30, 2026-09-22) | Same reasons as SMS: selective retry and full versioning. Trigger nodes must be programmatic anyway. |
| WhatsApp API contract | **`docs/contactwise-whatsapp-api.md`** (TIN-37, 2026-09-25) | The gateway is a transparent proxy over Meta's Graph API v23.0 at `/v1/waba-direct/{tenantId}/{**catch-all}`. Request, response and error shapes are Meta's. |
| WhatsApp Trigger signature check | **Raw body only** (TIN-40, 2026-09-28) | `verifyDelivery()` HMACs `req.rawBody`, the bytes n8n keeps for every webhook request. The parsed body is never re-serialised to verify: ContactWise writes emoji as escaped surrogate pairs and `JSON.stringify` doesn't, so a real delivery with an emoji would fail. No raw body, no stored secret, or a bad signature or timestamp: 401 and no workflow run. It starts from the TypeScript function in the TIN-34 integration contract. |
| WhatsApp Trigger subscription lifecycle | **Replace, never repair** (TIN-40, 2026-09-28) | `checkExists` is true only if the stored subscription is listed, `active`, for the current webhook URL and the same events, and the secret is stored. Otherwise it deletes the subscription (404 counts as deleted) and `create` registers a new one. ContactWise has no re-enable route for a subscription disabled after 24 h of failed deliveries. `delete` treats 404 as done and returns false (keeping the ID) on any other failure. |
| WhatsApp Trigger message status filter | **Off by default from v1.1** (TIN-60, 2026-09-28) | A v1 Trigger starts the workflow for its own replies' statuses, so one inbound message can set off a loop of runs and billed messages. v1 is published, so it's unchanged: `options.messageStatusUpdates`, default All, and an unset or empty list means every status. v1.1 has a top-level `messageStatusUpdates`, shown only when 'Trigger On' includes `messages`, default `[]`. An empty list means **no** statuses, and 'all' next to any other value means every status. Otherwise only the selected statuses start the workflow, in both versions. Other fields, and the `messages` in a change that also carries statuses, always pass. `deliveryToItems()` takes `{ selected, emptyMeans }`: v1 passes `'all'`, v1.1 `'none'`. Filtering stays in the node. ContactWise still delivers every `messages` event, and filtered-out deliveries get a 200 with no run. Server-side filtering is a later ContactWise enhancement. |
| WhatsApp Trigger in n8n 2.40 | **Observed live** (TIN-40, 2026-09-28) | Activation goes through n8n's publication outbox, so the activate call returns before the hooks run. A failed `checkExists` or `create` shows as the workflow's publication status `failed`, with the error's **message only** (no description), so each message must make sense on its own. n8n doesn't run `checkExists` again on restart: a subscription removed while n8n was down is replaced only when the workflow is deactivated and activated again. |
| WhatsApp Send and Wait | **Rebuilt on `n8n-workflow` primitives** (TIN-30, 2026-09-22) | A community node can't import nodes-base's `sendAndWait` helpers. The rebuild uses `getSignedResumeUrl`, `putExecutionToWait`, `WAIT_INDEFINITELY` and `SEND_AND_WAIT_OPERATION`. |
| Send and Wait response pages | **The node serves its own pages** (TIN-43 spike, 2026-09-25) | A webhook can call n8n's `form-trigger` view, but its data comes from nodes-base helpers a community node can't import, and the sandboxing CSP header comes from `n8n-core`. So `shared/responsePage.ts` renders self-contained pages: HTML-escaped, with no JavaScript or external assets, served with a strict CSP. Custom Form has text, textarea, number, email, date, dropdown and checkbox fields, with no file uploads. |
| Answering a Send and Wait link | **GET shows, POST records** (TIN-43, 2026-09-25) | Opening a link only shows a page. The answer is recorded, and the workflow resumed, only when the page's form is submitted, so link previews (WhatsApp, Slack, Teams) can't approve anything. A POST from a known bot user agent is ignored too. This costs the recipient one extra tap compared with the official node. |
| Test depth | **Vitest, L1 + L2** (2026-09-22) | L1: unit tests of pure logic (normalization, error mapping, retry decisions). L2: the node executed through `n8n-core`'s execution engine, with HTTP intercepted by nock. No automated real-n8n E2E; the UI check is manual via `npm run dev` / `dev:docker`. Real-API checks are manual on the test tenant (TIN-15). |
| L2 spike outcome | **Kept** (TIN-19, 2026-09-22) | `WorkflowExecute`, `ExecutionLifecycleHooks` and `Credentials` are public `n8n-core` exports, so there are no deep imports into its internals. Node and credential classes are registered directly (no build needed). `n8n-core` 2.40.3 and `n8n-workflow` 2.40.1 are pinned devDependencies that must move together. |
| Agent guardrails | **Block publishing, block runtime deps** (2026-09-22) | Enforced by Claude Code hooks. CI also checks that `dependencies` is empty. |
| Harness skills | **tdd, vitest, `/verify`, copy-review subagent** (2026-09-22) | Marketplace: `mattpocock/skills@tdd`, `antfu/skills@vitest`, installed at project level and committed so every contributor gets the same set. Project-authored: the `/verify` gate and a reviewer for node copy against `docs/n8n-guidelines.md`. |
| Coverage gate | **90% on logic modules** (2026-09-22) | Enforced in CI on `nodes/**/shared/*` (normalization, error mapping, retry policy, transport). Parameter-description files are excluded. |
| npm package name | **`@contactwise/n8n-nodes-contactwise`** (TIN-1, 2026-09-22) | Published under the ContactWise npm org, so the company owns it rather than a personal account, with the source in the public `contactwise-oss` GitHub org (moved from `ContactWise` on 2026-09-23 for an open-source home and because Actions on the `ContactWise` org was billing-locked; TIN-45). `repository.url` must match the repo that publishes, or npm rejects the provenance statement. `publishConfig.access` is `public` because scoped packages default to restricted. The GitHub repo keeps the unscoped name, and the `X-CW-Source` header keeps `n8n-nodes-contactwise/<version>` (TIN-6). |
