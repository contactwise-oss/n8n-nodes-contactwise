# Architecture

> Status: **scaffolded** (TIN-7). The layout below reflects the repo. Rows marked "planned" don't exist yet. Update this file whenever a decision below is made.

## Package shape

One npm package holds every ContactWise node and a **single shared credential type**. Verification allows one third-party service per package; SMS, the Trigger and WhatsApp all count as the same service (ContactWise).

| Artifact | Internal name | Phase |
|---|---|---|
| Credential `ContactWise API` | `contactWiseApi` | 1 |
| Node `ContactWise SMS` | `contactWiseSms` | 1 |
| Node `ContactWise Trigger` | `contactWiseTrigger` | 1.1 (blocked: no webhook-registration API yet) |
| Node `ContactWise WhatsApp` | `contactWiseWhatsApp` | 3 |

Internal names (node `name`, credential `name`, parameter `name`s, option `value`s) are permanent once published, because saved workflows store them.

Layout (paths marked `planned` arrive with the issue in brackets):

```
credentials/ContactWiseApi.credentials.ts      # API Key, Tenant ID, Default Entity ID; header auth; Test request
icons/contactwise.svg, contactwise.dark.svg    # placeholders until TIN-10; build copies them to dist/icons
nodes/ContactWiseSms/ContactWiseSms.node.ts    # node description + execute(); + ContactWiseSms.node.json (codex)
nodes/ContactWiseSms/resources/sms/send.ts     # planned (TIN-12): Send operation parameters
nodes/ContactWiseSms/shared/transport.ts       # planned (TIN-12/13): base URL, auth, source header, retry policy
nodes/ContactWiseSms/shared/phone.ts           # normalizeIndianMobile(): common input forms → E.164 +91…
nodes/ContactWiseSms/shared/…                  # planned (TIN-13): error mapping
.agents/                                       # n8n's generic agent docs (scaffold-owned, don't edit)
.github/workflows/ci.yml, publish.yml          # lint + build; tag-triggered provenance publish
```

`package.json` has `"n8n": { "strict": true }`, which is n8n Cloud eligibility mode: the ESLint config must stay the n8n default (`n8n-node cloud-support` shows the status). Only `credentials/**`, `nodes/**` and `package.json` are compiled, so anything else (tests, fixtures) stays out of `dist/`.

Once a second node exists, move code that both nodes use (transport, error mapping) out of `nodes/ContactWiseSms/shared/` into a package-level shared folder.

## Credential

| Field | Goes to |
|---|---|
| API Key (password) | `X-CW-Api-Key` header on every request |
| Tenant ID | URL path: `/v1/sms/{tenantId}/…` |
| Default Entity ID (optional) | Fallback for the SMS node's DLT Entity ID |

The base URL is fixed at `https://api.contactwise.io` and is not a user field.

**Test button:** `GET /v1/account/{tenantId}/me`, which sends no message. `responseCode` rules turn a 401 into "The 'API Key' is invalid, or it doesn't belong to this tenant" and a 404 into an inactive-tenant message. n8n's linter requires a credential test (`credential-test-required`). The harness can't run n8n's credential tester, so the Test button is verified in real n8n (TIN-15).

## SMS Send: per-item flow

Each input item makes one API call; there's no batching in Phase 1.

1. Resolve the entity ID: the node field, else the credential default, else an item error. **No API call** is made in the error case.
2. Normalize `to` to the canonical Indian mobile format. An invalid number becomes an item error, **with no API call**.
3. `POST /v1/sms/{tenantId}/send` with the source header (`X-CW-Source`, name pending TIN-6).
4. Map the response to an output item, or map the error to a thrown error or a Continue On Fail error item, per `docs/contactwise-sms-api.md`. Always keep `pairedItem`.

## Versioning

- Each node versions independently, starting at `1`. The npm package has its own semver.
- **Non-breaking** changes (a new optional parameter or option) use light versioning (`version: [1, 1.1]`), gating new fields with `displayOptions` on `@version`.
- **Breaking** changes get a new node version. Older versions must keep working for saved workflows.
- Full versioning (`VersionedNodeType` with `v1/`, `v2/` folders) is only available to programmatic-style nodes.

## Test seams

These are the agreed public boundaries tests are written at. They count as "pre-agreed seams" for the `tdd` skill, so don't re-ask for them. A new seam needs agreement first.

1. **Pure logic in `nodes/**/shared/`** (L1). Phone normalization (input string → canonical number or rejection), error mapping (HTTP status + body → user-facing error), retry decision (status + `Retry-After` + attempt → retry/wait or give up).
2. **Node execution** (L2). Workflow JSON with credentials goes in; output items or errors, plus the HTTP request the ContactWise API received, come out. HTTP is faked only at the network boundary (nock). Internal modules are never mocked.

The expected values for seam 2 come from `docs/contactwise-sms-api.md` (the request field table and the error table), never from the implementation.

### How tests are laid out

Tests live in a top-level `test/` folder, not next to the code. `tsconfig.json` compiles all of `nodes/**` into `dist/`, so tests there would ship in the package.

| Path | What it is |
|---|---|
| `test/setup.ts` | Closes the network before every test (`nock.disableNetConnect()`) |
| `test/harness/run-node.ts` | `runNode({ node, parameters, credentialTypes, credentials, input, continueOnFail })` runs one node through n8n-core's `WorkflowExecute` and returns `{ items, error, run }` |
| `test/harness/credentials-helper.ts` | Serves credentials from memory and applies `authenticate` (function or generic `={{$credentials.x}}`) |
| `test/harness/probe-node.ts` | Test-only node and credential that prove the harness itself |
| `test/fixtures/contactwise-api.ts` | `interceptSend(sendScenarios.x())`: a fake API with one scenario per error-table row. It records each request body and headers. |

Harness facts found in the spike (2026-09-22):
- `vitest.config.mjs` aliases `n8n-workflow` to its **CommonJS** build. n8n loads community nodes with `require()`, so node code and n8n-core must share one n8n-workflow instance. With two copies, `error instanceof NodeApiError` is false for errors n8n-core creates. A harness test guards this.
- n8n's defaults are wrong for SMS and must be overridden by our error mapping. A 500 surfaces as "The service was not able to process your request". A timeout says "consider setting the 'Retry on Fail' option", but retrying an SMS after a timeout can send it twice.
- `nock.replyWithError` needs an `Error` instance. A plain object makes the request hang.

## Decisions

| Topic | Status | Notes |
|---|---|---|
| Node style for `ContactWise SMS` | **Programmatic** (2026-09-22) | Needed for selective retry (429/503 only, honouring `Retry-After`) and direct unit testing of `execute()`, and it keeps full versioning available. The Trigger must be programmatic anyway. Trade-off accepted: more code than declarative, which n8n calls the faster route to approval. |
| Test depth | **Vitest, L1 + L2** (2026-09-22) | L1: unit tests of pure logic (normalization, error mapping, retry decisions). L2: the node executed through `n8n-core`'s execution engine, with HTTP intercepted by nock. No automated real-n8n E2E; the UI check is manual via `npm run dev` / `dev:docker`. Real-API checks are manual on the test tenant (TIN-15). |
| L2 spike outcome | **Kept** (TIN-19, 2026-09-22) | `WorkflowExecute`, `ExecutionLifecycleHooks` and `Credentials` are public `n8n-core` exports, so there are no deep imports into its internals. Node and credential classes are registered directly (no build needed). `n8n-core` 2.40.3 and `n8n-workflow` 2.40.1 are pinned devDependencies that must move together. |
| Agent guardrails | **Block publishing, block runtime deps** (2026-09-22) | Enforced by Claude Code hooks. CI also checks that `dependencies` is empty. |
| Harness skills | **tdd, vitest, `/verify`, copy-review subagent** (2026-09-22) | Marketplace: `mattpocock/skills@tdd`, `antfu/skills@vitest`, installed at project level and committed so every contributor gets the same set. Project-authored: the `/verify` gate and a reviewer for node copy against `docs/n8n-guidelines.md`. |
| Coverage gate | **90% on logic modules** (2026-09-22) | Enforced in CI on `nodes/**/shared/*` (normalization, error mapping, retry policy, transport). Parameter-description files are excluded. |
