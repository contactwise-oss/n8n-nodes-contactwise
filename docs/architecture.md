# Architecture

> Status: **planned**. Nothing is scaffolded yet (TIN-7). Update this file when the scaffold lands and whenever a decision below is made.

## Package shape

One npm package holds every ContactWise node and a **single shared credential type**. Verification allows one third-party service per package; SMS, the Trigger and WhatsApp all count as the same service (ContactWise).

| Artifact | Internal name | Phase |
|---|---|---|
| Credential `ContactWise API` | `contactWiseApi` | 1 |
| Node `ContactWise SMS` | `contactWiseSms` | 1 |
| Node `ContactWise Trigger` | `contactWiseTrigger` | 1.1 (blocked: no webhook-registration API yet) |
| Node `ContactWise WhatsApp` | `contactWiseWhatsApp` | 3 |

Internal names (node `name`, credential `name`, parameter `name`s, option `value`s) are permanent once published, because saved workflows store them.

Expected layout, following the n8n-node templates. Confirm it against the real scaffold and update this block:

```
credentials/ContactWiseApi.credentials.ts
icons/contactwise.svg, contactwise.dark.svg
nodes/ContactWiseSms/ContactWiseSms.node.ts    # node description; + ContactWiseSms.node.json (codex)
nodes/ContactWiseSms/resources/sms/send.ts     # Send operation parameters
nodes/ContactWiseSms/shared/transport.ts       # base URL, auth, source header, retry policy
nodes/ContactWiseSms/shared/…                  # phone normalization, error mapping
.agents/                                       # n8n's generic agent docs (scaffold-owned, don't edit)
.github/workflows/ci.yml, publish.yml          # lint + build; tag-triggered provenance publish
```

Once a second node exists, move code that both nodes use (transport, error mapping) out of `nodes/ContactWiseSms/shared/` into a package-level shared folder.

## Credential

| Field | Goes to |
|---|---|
| API Key (password) | `X-CW-Api-Key` header on every request |
| Tenant ID | URL path: `/v1/sms/{tenantId}/…` |
| Default Entity ID (optional) | Fallback for the SMS node's DLT Entity ID |

The base URL is fixed at `https://api.contactwise.io` and is not a user field. **No Test button** until the API has a lightweight authenticated GET endpoint (TIN-3). Until then, a bad key surfaces as a clear 401 message on the first send (decided 2026-09-22).

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

## Decisions

| Topic | Status | Notes |
|---|---|---|
| Node style for `ContactWise SMS` | **Programmatic** (2026-09-22) | Needed for selective retry (429/503 only, honouring `Retry-After`) and direct unit testing of `execute()`, and it keeps full versioning available. The Trigger must be programmatic anyway. Trade-off accepted: more code than declarative, which n8n calls the faster route to approval. |
| Test depth | **Vitest, L1 + L2** (2026-09-22) | L1: unit tests of pure logic (normalization, error mapping, retry decisions). L2: workflow JSON executed through `n8n-core`'s execution engine, with HTTP intercepted by nock, modelled on n8n's unpublished `NodeTestHarness`. No automated real-n8n E2E; the UI check is manual via `npm run dev`. Real-API checks are manual on the test tenant (TIN-15). |
| Agent guardrails | **Block publishing, block runtime deps** (2026-09-22) | Enforced by Claude Code hooks. CI also checks that `dependencies` is empty. |
| Harness skills | **tdd, vitest, `/verify`, copy-review subagent** (2026-09-22) | Marketplace: `mattpocock/skills@tdd`, `antfu/skills@vitest`, installed at project level and committed so every contributor gets the same set. Project-authored: the `/verify` gate and a reviewer for node copy against `docs/n8n-guidelines.md`. |
| Coverage gate | **90% on logic modules** (2026-09-22) | Enforced in CI on `nodes/**/shared/*` (normalization, error mapping, retry policy, transport). Parameter-description files are excluded. |
