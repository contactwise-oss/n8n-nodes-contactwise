# ContactWise WhatsApp API: the contract the node is built against

The public docs at https://docs.contactwise.io/ have no WhatsApp section yet (TIN-35), so this file is the contract. Facts the owner confirmed are marked **confirmed**. Request and response shapes come from Meta's WhatsApp Cloud API reference (Graph API v23.0), because the gateway passes them through unchanged. Anything marked **unconfirmed** needs checking against the live gateway before the public release (TIN-44).

## Base URL, path and auth (confirmed 2026-09-25, TIN-31)

- **Route:** `https://api.contactwise.io/v1/waba-direct/{tenantId}/{**catch-all}`. It forwards to `https://graph.facebook.com/v23.0/{**catch-all}`.
  - Example: `POST /v1/waba-direct/{tenantId}/{phone-number-id}/messages` → `POST graph.facebook.com/v23.0/{phone-number-id}/messages`.
- **Graph API version:** pinned by the gateway, and not part of the node's URL. A gateway version bump can change response shapes. Who bumps it, and how that's announced, is an open question on TIN-30.
- **Auth:** the same `X-CW-Api-Key` header as SMS, with the tenant ID in the path. The gateway swaps the key for the tenant's WhatsApp Business Account token, so the node never sees a Meta token.
- **One WhatsApp Business Account per tenant** (confirmed 2026-09-25). Its ID is the credential's optional 'WhatsApp Business Account ID' field. There's no per-node override. SMS never uses it.
- Requests, responses and Meta's errors pass through **unchanged**.
- **Path allowlist (TIN-32, live since 2026-09-28).** The gateway only forwards the Graph paths the nodes use, for the tenant's own phone numbers and WhatsApp Business Account. Media calls carry `?phone_number_id=`, the number the media belongs to (TIN-58, TIN-68).

## IDs the node works with

| ID | Where it comes from | Used in |
|---|---|---|
| WhatsApp Business Account ID (WABA ID) | Credential field `whatsAppBusinessAccountId` | `/{waba-id}/phone_numbers`, `/{waba-id}/message_templates` |
| Phone number ID | 'Phone Number' dropdown (from `/{waba-id}/phone_numbers`) | `/{phone-number-id}/messages`, `/{phone-number-id}/media` |
| Media ID | Returned by media upload, or by Meta in inbound messages | message `image.id` etc., `/{media-id}` |

The phone number ID is Meta's internal ID. It's **not** the display phone number.

## Operations

Each input item makes one API call (FR-W1). Every request sends the `X-CW-Source` header (FR-W4).

### List phone numbers: `GET /{waba-id}/phone_numbers` (TIN-39)

Used by the 'Phone Number' dropdown.

**200:** `{ "data": [ { "id", "display_phone_number", "verified_name", "quality_rating", … } ], "paging": { "cursors": { "before", "after" } } }`. The dropdown label is `{display_phone_number} - {verified_name}`, and the value is `id`.

### Send a message: `POST /{phone-number-id}/messages` (TIN-39)

```json
{ "messaging_product": "whatsapp", "recipient_type": "individual", "to": "<digits>", "type": "<type>", "<type>": { … } }
```

| `type` | Object | Notes |
|---|---|---|
| `text` | `{ "body", "preview_url" }` | `body` max 4096 characters |
| `image`, `video` | `{ "link" }` or `{ "id" }`, plus `caption` | |
| `document` | `{ "link" }` or `{ "id" }`, plus `caption`, `filename` | |
| `audio` | `{ "link" }` or `{ "id" }` | **No caption**: Meta doesn't support one (FR-W5) |
| `location` | `{ "latitude", "longitude", "name", "address" }` | |
| `contacts` | `[ { "name": { "formatted_name", … }, "addresses", "birthday", "emails", "org", "phones", "urls" } ]` | `name.formatted_name` is required |
| `template` | `{ "name", "language": { "code" }, "components": [ … ] }` | Send Template, TIN-41 |
| `interactive` | `{ "type": "button" \| "list" \| "flow", "header"?, "body": { "text" }, "footer"?, "action": { … } }` | Reply buttons and lists (TIN-61), Flows (TIN-63), below |

**Interactive messages** (TIN-61, from Meta's Cloud API reference, checked 2026-09-28):

```json
{ "type": "interactive", "interactive": {
    "type": "button",
    "header": { "type": "text", "text": "Sunrise Bakery" },
    "body": { "text": "What would you like to know?" },
    "footer": { "text": "Tap a button" },
    "action": { "buttons": [ { "type": "reply", "reply": { "id": "timings", "title": "Show timings" } } ] } } }
```

```json
{ "type": "interactive", "interactive": {
    "type": "list",
    "body": { "text": "Pick an option" },
    "action": { "button": "Menu", "sections": [ { "title": "Shows", "rows": [ { "id": "timings", "title": "Show timings", "description": "Friday to Sunday" } ] } ] } } }
```

| Field | Buttons | List |
|---|---|---|
| `header` (optional) | `{ "type": "text", "text" }`, text max 60. Meta also allows image, video and document headers; the node sends text only | Text only, max 60 |
| `body.text` | Required, max 1024 | Required, max 4096 |
| `footer.text` (optional) | Max 60 | Max 60 |
| `action` | `buttons`: 1–3 of `{ "type": "reply", "reply": { "id" (max 256), "title" (max 20) } }` | `button` (menu button text, max 20), `sections`: up to 10, with up to 10 `rows` in total. Each row: `id` (max 200), `title` (max 24), `description` (optional, max 72). A section `title` (max 24) is required when there's more than one section; the node sends one section |

**Flow messages** (TIN-63, from Meta's Cloud API reference, checked 2026-09-29). A Flow is a form that opens inside the chat. Creating, publishing and editing Flows happens in WhatsApp Manager, not through the node:

```json
{ "type": "interactive", "interactive": {
    "type": "flow",
    "header": { "type": "text", "text": "Thendral Hospital" },
    "body": { "text": "Book your appointment in a few taps." },
    "footer": { "text": "Takes under a minute" },
    "action": { "name": "flow", "parameters": {
        "flow_message_version": "3",
        "flow_id": "1000000000000005",
        "flow_cta": "Book now",
        "flow_token": "appt-447700900123",
        "flow_action": "navigate",
        "flow_action_payload": { "screen": "APPOINTMENT", "data": { "department": "cardiology" } },
        "mode": "draft" } } } }
```

| Parameter | Rule | Node field |
|---|---|---|
| `flow_message_version` | Always `"3"` | Not shown |
| `flow_id` or `flow_name` | One of them, required | 'Flow' (*By ID* or *By Name*) |
| `flow_cta` | Required, max 20 | 'Flow Button Text' |
| `flow_token` | Optional; Meta uses `"unused"` when it's left out. Returned with the submission | 'Flow Token' |
| `flow_action` | `"navigate"` or `"data_exchange"` (Meta's default is navigate; the node's is data_exchange) | 'Flow Action' |
| `flow_action_payload` | Navigate only: `{ "screen", "data"? }`, where `data` is a non-empty object. Left out for data_exchange | 'Screen', 'Screen Data (JSON)' |
| `mode` | `"draft"` to send an unpublished Flow; left out means published | *Additional Fields › Draft Mode* |

`body.text` is required, max 1024. The header is text only, max 60, and the footer max 60, as for buttons. Listing a WABA's Flows (`GET /{waba-id}/flows`) isn't allowed through the gateway yet (TIN-64), so the node has no Flow dropdown.

**A submitted Flow arrives at the Trigger** as an incoming message with `type: "interactive"` and `interactive: { "type": "nfm_reply", "nfm_reply": { "name": "flow", "body": "Sent", "response_json": "{\"flow_token\":\"appt-447700900123\", …}" } }`. `response_json` is a **JSON string** holding the `flow_token` and the values from the Flow's last screen. From Trigger version 1.2 (TIN-66) the node also adds `nfm_reply.response`, the parsed object, and keeps `response_json` unchanged. If `response_json` isn't a JSON object, the message is passed on unchanged. Versions 1 and 1.1 pass the string only.

**A tap arrives at the Trigger** as an incoming message with `type: "interactive"`: `interactive: { "type": "button_reply", "button_reply": { "id", "title" } }` for a button, or `{ "type": "list_reply", "list_reply": { "id", "title", "description" } }` for a list row. Interactive messages are free-form, so they're only allowed inside the 24-hour window.

`to`: the international number as digits only, 8–15 digits, no `+` (FR-W2). There's no country restriction and no DLT.

**200:** `{ "messaging_product": "whatsapp", "contacts": [ { "input", "wa_id" } ], "messages": [ { "id" } ] }`. A 200 means Meta **accepted** the message, not that it was delivered. Delivery arrives later as a status event, through the ContactWise WhatsApp Trigger (TIN-40).

Outside the 24-hour customer service window, only templates can be sent. Free-form messages then fail with 131047.

### List templates: `GET /{waba-id}/message_templates?status=APPROVED` (TIN-41)

**200:** `{ "data": [ { "id", "name", "language", "status", "category", "components" } ], "paging": { "cursors": { "after" }, "next" } }`. Follow `paging.cursors.after` until there's no `next`: the list is paged. The official node reads only the first page, which is a bug (FR-W5).

### Upload media: `POST /{phone-number-id}/media` (TIN-39, TIN-42)

Multipart form: `messaging_product=whatsapp`, `type=<mime type>`, `file=<binary>`. Built with native `FormData`/`Blob`, with no `form-data` package.

**200:** `{ "id": "<media-id>" }`.

### Media metadata and delete: `GET` / `DELETE /{media-id}` (TIN-42; Download is TIN-55)

- `GET` 200: `{ "messaging_product", "url", "mime_type", "sha256", "file_size", "id" }`. The `url` needs Meta's token, which the customer doesn't have. So Media → Download uses the route below, and the node never calls this `GET`.
- `DELETE /{media-id}?phone_number_id=<phone-number-id>` 200: `{ "success": true }`.
- **`phone_number_id` (TIN-58, TIN-68):** the number the media belongs to. Inbound media belongs to the number that received the message (the webhook's `metadata.phone_number_id`); uploaded media to the number it was uploaded with. Any other number, even another of the tenant's own, gets 400 `(#10) Permission denied` (checked 2026-09-28). The gateway checks the number is the tenant's. Once TIN-58 is enforced, a media call without it gets **403** `{ "error": "<message>" }`. The node sends it whenever 'Phone Number' is set, which node version 1.4 requires; versions 1–1.3 send it only when set. Both errors point the user at 'Phone Number'.

### Download media: `GET /v1/whatsapp/{tenantId}/media/{mediaId}/content` (TIN-33, TIN-55)

Confirmed by the API team on 2026-09-26 (TIN-33). This is a gateway route, **not** under `/v1/waba-direct/`: the gateway looks up Meta's media URL with the tenant's token and streams the file back.

- **Query:** `?phone_number_id=<phone-number-id>`, the number the media belongs to, as for `DELETE` above (TIN-58, TIN-68).
- **Auth:** the same `X-CW-Api-Key` header. A bad key and an unknown tenant both get 401 `{ "error": "Invalid API key." }`.
- **200:** the file's bytes, with these headers:

| Header | Value |
|---|---|
| `Content-Type` | Meta's `mime_type`, e.g. `image/jpeg`, `audio/ogg; codecs=opus` |
| `Content-Length` | The file size, when known |
| `Content-Disposition` | `attachment; filename="<mediaId>.<ext>"`. Meta doesn't keep the original filename |
| `X-CW-Media-SHA256` | Meta's `sha256` |

- **Errors:** gateway errors have the body `{ "error": "<message>" }`. Meta's errors pass through in Meta's envelope.

| Status | When |
|---|---|
| 400 | `mediaId` isn't a valid media ID |
| 401 | Bad key, or unknown tenant |
| 403 | `phone_number_id` is missing (once TIN-58 is enforced) or isn't the tenant's |
| 404 | Not found, expired, deleted, or owned by another tenant. The same body for all four |
| 429 / 503 | Rate limited or unavailable, with `Retry-After` |
| 502 | Meta's download URL failed, e.g. it expired |
| 504 | Meta took more than 30 s to send headers, or went 30 s without sending data |
| Meta's status | Meta rejected the lookup for another reason |

If the stream breaks after the headers, the gateway aborts the connection, so the node sees a network error, not a short file.

- **No side effects:** a download changes nothing, so the node retries 429, 503, 502, 504 and network errors (see Errors).
- **Routing confirmed (2026-09-26):** `api.contactwise.io` routes `/v1/whatsapp/` to the gateway. Without a key it returns 401 `{ "error": "Missing X-CW-Api-Key header." }`.

### Webhook subscriptions and signed forwarding (TIN-34)

Live since 2026-09-28. The source of truth is the Linear document "Integration contract: ContactWise WhatsApp Trigger (TIN-34 forwarding)", with the spec "Spec: WhatsApp webhook subscriptions and signed forwarding (TIN-34)". What the WhatsApp Trigger relies on:

| Route (gateway, `X-CW-Api-Key`) | Result |
|---|---|
| `POST /v1/whatsapp/{tenantId}/webhooks` `{ url, fields, description }` | 201 with `id`, `url`, `fields`, `description`, `status`, `createdAt` and `secret` (only here) |
| `GET /v1/whatsapp/{tenantId}/webhooks` | 200 `{ "data": [...] }`, newest first, no secrets |
| `DELETE /v1/whatsapp/{tenantId}/webhooks/{id}` | 204, or 404 if missing or another tenant's |

- `url` must be public `https://` (any port). localhost, `http://`, private, loopback and link-local addresses, `.local`/`.internal`/`.home.arpa`, single-label hosts, credentials in the URL and unresolvable hosts get 400 `{ "error": "<the problem>" }`.
- 50 subscriptions per tenant (409 for the 51st; disabled ones count). 120 requests per minute per tenant across these routes. The same URL twice makes two subscriptions with different secrets.
- `status` is `active` or `disabled`. A subscription with no 2xx for 24 hours is disabled for good: there's no re-enable route.

Each delivery is one `POST` per Meta event (a batch is never split) with Meta's envelope `{ object, entry: [ { id, changes: [ { field, value } ] } ] }`, filtered to the tenant and the subscribed fields. Unmodelled properties such as `entry[].time` pass through. Headers: `X-CW-Signature-256`, `X-CW-Timestamp` (unix seconds), `X-CW-Webhook-Id`, `X-CW-Delivery-Id` (stable across retries and Meta re-deliveries), `User-Agent: ContactWise-Webhooks/1.0`.

- **Signature:** `"sha256=" + lowercase hex(HMAC-SHA256(secret, timestamp + "." + raw body))`. The key is the whole `whsec_…` string. During rotation the header holds `sha256=<new>,sha256=<old>`. Test vector: secret `whsec_test`, timestamp `1790000000`, body `{"object":"whatsapp_business_account","entry":[]}` → `sha256=4d061e812335c3afeac2dc33f8be8e2ee7a7f6e95a104a57fefc05b74edf8bb9`.
- **Raw body:** ContactWise writes characters outside the BMP (emoji) as escaped surrogate pairs, so re-serialising the parsed body changes the bytes and fails the check.
- **Delivery:** any 2xx within 10 s is success. Retries after about 1 min, 5 min, 30 min, 2 h and 6 h, then every 6 h up to 24 h. A 3xx is a failure and isn't followed. At least once, in no particular order.

## Errors

### Status rules come first

These are the same send-safety rules as SMS (`nodes/shared/errors.ts`, `nodes/shared/retry.ts`):

| Status | Meaning | Node: retry? |
|---|---|---|
| 429, 503 | Nothing was sent | **Yes**, honouring `Retry-After`. At most 3 attempts and 60 s of total waiting |
| 500 and other 5xx | **Outcome unknown**: the message may have been sent | **Never** |
| 502 / 504 / timeout | Outcome unknown | **Never** |

Media → Download is the exception: it has no side effects, so it also retries 502, 504 and network errors, with the same limits. It still never retries a 500.

There are no idempotency keys, so a retry after an unknown outcome can deliver the message twice.

**Unconfirmed:** whether the gateway itself sends 429 or 503 with `Retry-After`, and what body it uses. Also unconfirmed: what the gateway returns for a bad or missing `X-CW-Api-Key`. The node assumes 401, as for SMS (TIN-35).

### Meta's error envelope

For other 4xx responses the body is Meta's:

```json
{ "error": { "message": "(#131047) Re-engagement message", "type": "OAuthException", "code": 131047,
  "error_data": { "messaging_product": "whatsapp", "details": "…" }, "fbtrace_id": "…" } }
```

The node strips the `(#code)` prefix, shows `error_data.details`, and quotes `fbtrace_id` as the trace ID. It branches on `code`, never on `message`.

| Code | Meaning | Fix the node gives |
|---|---|---|
| 131047 | More than 24 hours since the recipient last messaged | Send an approved template instead |
| 130429 | The number's throughput limit was reached | Send more slowly, then run the workflow again |
| 131056 | Too many messages to the same recipient in a short time | Wait before sending to this recipient again |
| 131026 | Undeliverable: not on WhatsApp, or an old app | Check that the number is on WhatsApp |
| 132000–132999 | Template problems: doesn't exist, not approved, paused, or wrong parameter count | Check the template, its language and its parameters |
| anything else | | Check the WhatsApp message and recipient |

Some failures, including 131047 and 131026, can also arrive **later as a failed status webhook** instead of a synchronous error. Those only show up through the trigger (TIN-40).
