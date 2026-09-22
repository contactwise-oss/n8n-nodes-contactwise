# ContactWise SMS API: the contract the node is built against

Public docs: https://docs.contactwise.io/ (Postman). Where they disagree with this file, **this file** describes production behaviour. The public docs are being corrected (TIN-5).

## Base URL and auth

- Base URL: `https://api.contactwise.io`. The public docs' auth example says `.com`, which is wrong.
- Header: `X-CW-Api-Key: <key>`. The tenant ID goes in the path. A valid key used with another tenant's ID returns 401.

## Send one SMS: `POST /v1/sms/{tenantId}/send`

| Field | Type | Required | Node source | Notes |
|---|---|---|---|---|
| `from` | string | yes | Sender ID | DLT-registered header |
| `to` | string | yes | To, normalized | Always sent as **E.164**: `+91` followed by 10 digits starting 6–9, e.g. `+919876543210` (decided 2026-09-22, TIN-2) |
| `country` | string | yes | constant `"IN"` | `"INTL"` exists but is out of scope |
| `body` | string | yes | Message | Must match the DLT template with its variables filled |
| `templateId` | string | yes (IN) | DLT Template ID | |
| `entityId` | string | yes (IN) | DLT Entity ID, or the credential default | |
| `messageType` | int | yes | Options › Message Type | 0 Text, 1 Unicode, 2 Auto (node default) |
| `serviceType` | int | yes | Service Type | 0 Transactional (node default), 1 Promotional; 99 Unknown is not exposed |
| `flash` | bool | yes | Options › Flash | Node default `false` |
| `customId` | string | no | Options › Custom ID | Echoed back in delivery reports |
| `metadata` | object (string → string) | no | Options › Metadata | Max 10 pairs; echoed back in delivery reports |
| `callbackUrl` | URI | no | Options › Callback URL | Overrides the org-wide delivery-report URL |

Always send the fields marked "yes", even when they hold their default values.

## Responses

**200:** `{ "messageId": "…", "status": "accepted", "timestamp": "…" }`. `accepted` means queued, **not delivered**. The public docs still show `{ "id" }`, which is outdated.

| Status | Body | Meaning | Node: retry? |
|---|---|---|---|
| 400 | `{ "errors": [ { "field", "code", "message" } ] }` | Validation failed, nothing sent. Lists **every** broken rule | No |
| 400 | `application/problem+json`, `errors` is an object keyed by field | Malformed or empty JSON (framework default) | No |
| 401 | empty | Missing key, or the key belongs to another tenant | No |
| 429 | `errors` shape, code 9010, `Retry-After` (whole seconds, ≥1) | Per-tenant rate limit, nothing sent. Can be enabled at any time | **Yes**, honour `Retry-After` |
| 503 | `errors` shape, code 9011, `Retry-After` | Messaging backend down, nothing sent | **Yes**, honour `Retry-After` |
| 500 | `{ "error": "An unexpected error occurred", "traceId" }` | **Outcome unknown**: the SMS may have been sent | **Never** |
| 502 / 504 / timeout | from the gateway, possibly not JSON | Outcome unknown | **Never** |

Error codes: 1001 tenant · 9000 country · 9002–9004 sender ID · 9007 recipient · 9008/9009 body · 9010 rate limited · 9011 backend unavailable.

Branch on `code`, never on `message`, because the wording can change. The JSON type of `code` is unconfirmed, so accept both numbers and strings.

There are no idempotency keys yet, which is why uncertain outcomes are never retried.

## DLT primer (India)

TRAI requires commercial SMS to Indian numbers to be registered on a DLT platform:

- **Entity** (PE ID): the sending business. Most tenants have one, some have several.
- **Header** (sender ID): registered under an entity.
- **Content template**: registered text with `{#var#}` placeholders, linked to headers, with a category (transactional, service or promotional).

`body` must equal the template text with each placeholder replaced. A mismatch can still come back `accepted` and then fail at the operator's DLT scrub. That failure is only visible in delivery reports.

DND scrubbing and the promotional time window are enforced by the ContactWise API, not the node.

## Not used in Phase 1

`/send-personalized`, `/bulk`, `/bulk-personalized`, and the Sender/Template/Links/Campaigns endpoints.
