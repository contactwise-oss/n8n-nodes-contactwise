# @contactwise/n8n-nodes-contactwise

Send DLT-compliant SMS to recipients in India, and send and receive WhatsApp messages, from your [n8n](https://n8n.io/) workflows and AI agents, using [ContactWise](https://docs.contactwise.io/). You don't need your own Meta account or access token.

- **ContactWise SMS › Send**: one SMS per input item, with the DLT sender, template and entity your business has registered.
- **ContactWise WhatsApp**: send text, media, locations, contact cards and approved templates; send a message and wait for the recipient's answer; upload, download and delete media.
- **ContactWise WhatsApp Trigger**: start a workflow when a customer messages you, when a message you sent is delivered, read or fails, or when a template or account changes.
- Failures say clearly whether the message was sent, so you never double-send by accident.

[Installation](#installation) · [Credentials](#credentials) · **SMS:** [Send an SMS](#send-an-sms) · [DLT](#dlt-in-60-seconds) · [Output](#output) · [Delivery reports](#delivery-reports) · [Failures](#when-a-send-fails) · **WhatsApp:** [Send](#send-a-whatsapp-message) · [Templates](#templates-and-the-24-hour-window) · [Media](#media) · [Send and Wait](#send-and-wait-for-a-response) · [Trigger](#whatsapp-trigger) · [Failures](#when-a-whatsapp-call-fails) · [AI agents](#using-it-as-an-ai-agent-tool) · [Examples](#example-workflows) · [Compatibility](#compatibility)

## Installation

**Self-hosted n8n:** go to **Settings › Community Nodes › Install**, enter `@contactwise/n8n-nodes-contactwise`, and confirm. See n8n's [community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

**n8n Cloud:** available from the nodes panel once n8n has verified the package.

## Credentials

Create a **ContactWise API** credential:

| Field | What to enter |
|---|---|
| API Key | Your ContactWise API key |
| Tenant ID | Your ContactWise tenant ID |
| Default Entity ID | *Optional, SMS only.* Your DLT principal entity ID (PE ID). Used whenever a node's 'DLT Entity ID' is empty, so you don't repeat it on every node |
| WhatsApp Business Account ID | *Optional, WhatsApp only.* Your tenant's WhatsApp Business Account ID. The WhatsApp node needs it to list your phone numbers and templates |

Don't have an API key, tenant ID or WhatsApp Business Account ID? Contact ContactWise support. One credential works for all three nodes.

**Test** checks the key against your tenant without sending anything. It reports an invalid key, a key that belongs to another tenant, or an inactive tenant.

## Send an SMS

Add the **ContactWise SMS** node and pick **Send SMS**.

| Field | Required | Notes |
|---|---|---|
| Sender ID | Yes | Your DLT-registered sender ID, e.g. `CWDEMO` |
| To | Yes | A mobile number in India: 10 digits starting 6–9, with or without `0`, `91` or `+91`, spaces or dashes |
| Message | Yes | Must match the content registered under 'DLT Template ID' exactly, with each `{#var#}` replaced by its value |
| DLT Template ID | Yes | The ID of your registered content |
| DLT Entity ID | If no credential default | Overrides the credential's 'Default Entity ID' |
| Service Type | Yes | Transactional (default) or Promotional. Must match how the template is registered |

**Options**

| Option | Default | Notes |
|---|---|---|
| Message Type | Auto | Auto, Text (plain GSM characters) or Unicode (Indian languages, emoji) |
| Flash | Off | Shows the SMS on screen without saving it to the inbox |
| Custom ID | — | Your own value, returned in the output and in delivery reports |
| Metadata | — | Up to 10 name/value pairs, returned in delivery reports |
| Callback URL | — | Where delivery reports for this SMS go, instead of your account-wide URL |

Every field accepts expressions, so you can map `To`, `Message` and the rest from earlier nodes.

## DLT in 60 seconds

Indian regulations (TRAI) require every commercial SMS to be registered on a DLT platform before it can be delivered:

1. **Entity**: your business, identified by a principal entity ID (PE ID).
2. **Sender ID**: the name the SMS comes from, registered under your entity.
3. **Content template**: the exact text of each message, with `{#var#}` where values change. It's registered with a category (transactional, service or promotional) and gets a template ID.

The node's 'Message' must equal the registered template text with each `{#var#}` filled in. For example:

- Template: `Hi {#var#}, your order {#var#} has shipped. - CWDEMO`
- Message: `Hi Asha, your order 1042 has shipped. - CWDEMO`

A mismatch may still be accepted by ContactWise, and then fail at the operator's DLT check. Watch your delivery reports while you set up a new template.

ContactWise applies DND and promotional time-window rules for you.

## Output

One item per input item:

```json
{
  "messageId": "…",
  "status": "accepted",
  "timestamp": "2026-09-22T10:00:00Z",
  "to": "+919876543210",
  "customId": "order-1042"
}
```

`accepted` means ContactWise has queued the SMS, **not** that it was delivered. Delivery arrives later as a delivery report.

## Delivery reports

There's no SMS trigger node yet, so route SMS delivery reports into n8n yourself:

1. Add an n8n **Webhook** node (POST) and copy its production URL.
2. Put that URL in the Send node's **Options › Callback URL**.

Each report includes the 'Custom ID' and 'Metadata' you sent, so you can match it to the original item.

## When a send fails

Every failure says whether the SMS was sent:

| Situation | Was it sent? | The node |
|---|---|---|
| Validation (e.g. sender not registered, message doesn't match template) | No | Shows every reason with what to fix |
| Invalid API key or wrong tenant | No | Points you to the credential |
| Rate limited (429) or service unavailable (503) | No | Waits for `Retry-After` and tries again, up to 3 attempts within 60 seconds, then stops |
| Invalid 'To', missing 'DLT Entity ID', more than 10 metadata pairs | No | Stops before calling ContactWise |
| Server error (500), gateway error (502/504), timeout | **Maybe** | Stops and says the SMS may already have been sent. It never retries. A 500 includes a trace ID for ContactWise support |

> [!WARNING]
> **Don't turn on n8n's *Retry On Fail* setting for this node.** It retries after any failure, including ones where the SMS may already have gone out, so the recipient could get it twice. The node already retries the cases that are safe to retry.

With **Settings › On Error › Continue**, a failed item becomes an output item instead of stopping the workflow:

```json
{
  "error": "ContactWise rejected the SMS: Sender ID is not registered [item 0]",
  "errorDetails": {
    "httpStatus": 400,
    "outcome": "not-sent",
    "codes": [9002],
    "messages": ["Sender ID is not registered"],
    "description": "Nothing was sent. Check that 'Sender ID' is registered on DLT and active for your account."
  }
}
```

`outcome` is `not-sent` or `unknown`. Treat `unknown` as "check delivery reports before sending again".

ContactWise error codes: 1001 tenant · 9000 country · 9002–9004 sender ID · 9007 recipient · 9008/9009 message body · 9010 rate limited · 9011 service unavailable.

## Send a WhatsApp message

Add the **ContactWise WhatsApp** node and pick **Send message**.

| Field | Notes |
|---|---|
| Phone Number | The WhatsApp number you send from. Pick it from the list, or enter its phone number ID |
| Recipient Phone Number | Any country, in international format: country code then number, e.g. `+44 7700 900123` or `919876543210`. Spaces, dashes, dots, brackets and a leading `+` are ignored |
| Message Type | Text, Image, Video, Document, Audio, Location, Contact or Interactive |

- **Text:** 'Text' (up to 4,096 characters). *Additional Fields › Show URL Preview* shows a preview of the first link.
- **Image, Video, Document, Audio:** 'Media Source' is a public **Link**, a **Media ID** from *Media › Upload media*, or a **Binary File** from an earlier node, which is uploaded for you first. Images, videos and documents can have a caption, and documents a filename. Audio has no caption: WhatsApp doesn't support one.
- **Location:** 'Latitude' and 'Longitude', with an optional 'Location Name' and 'Location Address'.
- **Contact:** a contact card. 'Formatted Name' is required; names, phones, emails, addresses, organization, URLs and birthday are optional.
- **Interactive:** a message the recipient answers with a tap. 'Interactive Type' is **Buttons** (1–3 reply buttons, each with an 'ID' and a 'Title' of up to 20 characters) or **List** (a 'Menu Button Text' that opens 1–10 'Rows', each with an 'ID', a 'Title' of up to 24 characters and an optional 'Description'). 'Body' is the message text. *Additional Fields* adds a 'Header', a 'Footer', and a list's 'Section Title'. Like any free-form message, it can only be sent within the 24-hour window. Interactive needs node version 1.1, so add a new ContactWise WhatsApp node to a workflow built before version 0.4.0 of this package.
- **Buttons or Rows as JSON:** set 'Specify Buttons' (or 'Specify Rows') to **Using JSON** and set 'Buttons (JSON)' (or 'Rows (JSON)') to an array, for example `{{ $json.buttons }}`. Use this when the options change per message, for example when an AI Agent picks them. Each button is `{ "id": "yes", "title": "Yes" }`; each row can also have a `"description"`. A JSON string of the array works too. The same limits apply (1–3 buttons, 1–10 rows), and a malformed entry fails the item before anything is sent. Using JSON needs node version 1.2 (package version 0.5.0), so add a new ContactWise WhatsApp node to a workflow built earlier.

The output is WhatsApp's answer, with the message ID in `messages[0].id`:

```json
{
  "messaging_product": "whatsapp",
  "contacts": [{ "input": "447700900123", "wa_id": "447700900123" }],
  "messages": [{ "id": "wamid.HBgLNDQ3NzAwOTAwMTIzFQIAERgSMA==" }]
}
```

This means WhatsApp **accepted** the message, not that it was delivered. Delivery, read receipts and failures arrive later through the [WhatsApp Trigger](#whatsapp-trigger).

## Templates and the 24-hour window

WhatsApp lets you send a free-form message only within **24 hours of the recipient's last message to you**. Outside that window, and to start a conversation, send an approved **template** instead. A free-form message outside the window fails with "More than 24 hours have passed since the recipient last messaged you".

Pick **Send template message**:

| Field | Notes |
|---|---|
| Template | One of your approved templates, listed as `name (language)`. In **Name and Language** mode, enter `name|language`, e.g. `order_update|en_US` |
| Components | The values for the template's variables, in order: **Header** (text, currency, date and time, image, video or document), **Body** (text, currency, date and time) and **Button** (a quick-reply payload or the dynamic end of a URL, by button index) |

For authentication templates, the one-time code goes in both the body and a URL button with index 0. WhatsApp shows that button as **Copy Code**.

Templates are created and approved in your WhatsApp Business Account, not in n8n.

## Media

Use the **Media** resource:

| Operation | Does | Output |
|---|---|---|
| Upload media | Uploads a binary file from an earlier node to your phone number | `{ "id": "<media ID>" }`, to send by ID |
| Download media | Downloads a media file by ID, such as the image in a customer's message | The file in a binary field (default `data`), with its MIME type and filename |
| Delete media | Deletes a media file by ID | `{ "success": true }` |

WhatsApp keeps media for 30 days. You can only download or delete media that belongs to your own WhatsApp Business Account.

## Send and wait for a response

**Send message and wait for response** sends a WhatsApp message with links, pauses the workflow, and continues when the recipient answers.

| Response Type | The recipient | The output |
|---|---|---|
| Approval | Taps **Approve**, or **Approve** / **Decline** (`Type of Approval: Approve and Decline`) | `{ "data": { "approved": true, "respondedAt": "…" } }` |
| Free Text | Opens a page and types an answer | `{ "data": { "text": "…", "respondedAt": "…" } }` |
| Custom Form | Opens a page with your fields: text, textarea, number, email, date, dropdown or checkbox | `{ "data": { "<Field Label>": "…", "respondedAt": "…" } }` |

- Opening a link only shows a page. The answer is recorded only when the recipient submits the page, so WhatsApp's link previews can't answer for them.
- *Options › Limit Wait Time* continues the workflow after a time or at a date even without an answer.
- The message is a normal WhatsApp message, so the 24-hour window applies. The links go to your n8n, which must be reachable from the recipient's phone.

## WhatsApp Trigger

Add the **ContactWise WhatsApp Trigger** node, pick the events under 'Trigger On', and activate the workflow. On activation the node registers the workflow's webhook URL with ContactWise; on deactivation it removes it.

| Trigger On | Starts the workflow for |
|---|---|
| Messages | Incoming messages. Status updates (sent, delivered, read, failed or deleted) for messages you sent, but only the ones you select under 'Message Status Updates' |
| Message Template Status Update, Message Template Quality Update, Template Category Update | Changes to your templates |
| Account Update, Account Review Update, Business Capability Update, Phone Number Name Update, Phone Number Quality Update, Security | Changes to your WhatsApp Business Account and numbers |

**Message Status Updates** (shown when 'Trigger On' includes 'Messages') picks which status updates start the workflow:

- **Empty** (the default): none. Only incoming messages start the workflow.
- **All**, alone or with other options: every status.
- **Any other selection**, for example only **Failed**: just those statuses.

Incoming messages and the other events always start the workflow.

> [!WARNING]
> **Replying to status updates can send messages in a loop.** Each reply you send gets its own sent, delivered and read statuses. If those start the workflow and it replies again, every reply triggers more replies, and each one is a billed message. If a workflow both replies and listens for statuses, add an **If** node before the reply that continues only when `{{ $json.messages }}` exists, so only incoming messages get an answer.

Trigger nodes added before version 0.3.2 of this package (node version 1) keep their old behaviour: the setting is under *Options › Message Status Updates*, and when it isn't set, every status starts the workflow. To switch such a workflow to the new default, replace its trigger with a new **ContactWise WhatsApp Trigger**, or add the **If** node above.

> [!IMPORTANT]
> ContactWise must be able to reach your n8n: its webhook URL has to be a **public `https://` address**. On a self-hosted n8n, set `WEBHOOK_URL` to your public URL. n8n on `localhost` or a private network can't receive events, and activation fails with ContactWise's reason, for example "url must use https://.".

Each change in an event becomes one item: WhatsApp's `value`, plus `field`, `whatsAppBusinessAccountId` and `deliveryId`. An incoming text message looks like this:

```json
{
  "messaging_product": "whatsapp",
  "metadata": { "display_phone_number": "15550001111", "phone_number_id": "100000000000002" },
  "contacts": [{ "profile": { "name": "Asha" }, "wa_id": "447700900123" }],
  "messages": [{ "from": "447700900123", "id": "wamid.…", "type": "text", "text": { "body": "Hi 👋" } }],
  "field": "messages",
  "whatsAppBusinessAccountId": "100000000000001",
  "deliveryId": "dlv_8_dZvztsSsZqRAMrlPSZzp"
}
```

- **Signed:** every event is signed by ContactWise. Requests that aren't correctly signed, or are more than 5 minutes old, are refused with 401 and start nothing.
- **At least once, in any order:** an event can arrive twice, and a `read` status can arrive before `delivered`. If a workflow must not run twice for one event, deduplicate on `deliveryId`: it stays the same when an event is delivered again.
- **Reply to a message** by sending to `{{ $json.messages[0].from }}` from `{{ $json.metadata.phone_number_id }}`. A reply is inside the 24-hour window, so it can be free-form.
- **Buttons and lists:** when someone taps a reply button or picks a list row, the message arrives with `type` `interactive`. The button's 'ID' is in `{{ $json.messages[0].interactive.button_reply.id }}`, and a row's in `{{ $json.messages[0].interactive.list_reply.id }}`. Route on the ID with a Switch node.
- **Listen for test event** in the editor registers a temporary webhook, removed when listening stops.
- If a workflow was deactivated while n8n was down, ContactWise disables its webhook after 24 hours of failed deliveries. Deactivate and activate the workflow to register a new one.

## When a WhatsApp call fails

The WhatsApp node follows the same rules as SMS: every failure says whether the message was sent, only 429 and 503 are retried, and a 500, 502, 504 or timeout is never retried because the message may already have gone out. WhatsApp's own errors are shown with a fix for the common ones:

| WhatsApp code | Meaning |
|---|---|
| 131047 | More than 24 hours since the recipient's last message: send a template |
| 131026 | The recipient can't receive this message: check the number is on WhatsApp |
| 131056 | Too many messages to this recipient in a short time |
| 130429 | Your number's sending limit was reached |
| 132000–132999 | The template doesn't exist in this language, isn't approved, or its parameters don't match |

With *On Error › Continue*, a failed item carries `error` and `errorDetails`, as for SMS. `errorDetails.traceId` is WhatsApp's trace ID for support. Downloads have no side effects, so they're also retried after a 502, 504 or broken connection.

The Retry On Fail warning above applies to the WhatsApp node too.

## Using it as an AI agent tool

The SMS and WhatsApp nodes work as tools for n8n's **AI Agent**. The agent can fill in fields such as 'To' and 'Message' for SMS, or 'Recipient Phone Number' and 'Text' for WhatsApp, with `$fromAI()` expressions.

Each call sends a real, billable message. Keep these fixed on the tool rather than left to the agent:
- for SMS, 'Sender ID', 'DLT Template ID' and 'DLT Entity ID', and enough of 'Message' that it still matches the template
- for WhatsApp, 'Phone Number' and, for templates, 'Template'

Consider requiring human approval before the tool runs.

## Example workflows

Import these from the n8n editor (**⋯ › Import from File**). Then select your ContactWise API credential, and replace the example values (sender and template IDs, phone numbers, template names) with yours. In the WhatsApp examples, pick your 'Phone Number' from the list.

- [`examples/webhook-order-sms.json`](examples/webhook-order-sms.json): send an order confirmation SMS when a webhook receives a new order. The order ID becomes the 'Custom ID'.
- [`examples/bulk-list-sms.json`](examples/bulk-list-sms.json): send to a list of recipients, one SMS each. It uses *On Error: Continue* so one bad number doesn't stop the rest.
- [`examples/whatsapp-send-text.json`](examples/whatsapp-send-text.json): send a WhatsApp text message.
- [`examples/whatsapp-send-template.json`](examples/whatsapp-send-template.json): start a conversation with an approved template that has one body variable.
- [`examples/whatsapp-approval.json`](examples/whatsapp-approval.json): ask for approval over WhatsApp and branch on the answer.
- [`examples/whatsapp-trigger-reply.json`](examples/whatsapp-trigger-reply.json): reply to every incoming WhatsApp text message.

## Compatibility

Built and tested against n8n 2.40. Requires an n8n version that supports community nodes. On n8n Cloud it also needs verification (pending). The WhatsApp Trigger needs n8n to be reachable on a public `https://` URL.

## Resources

- [ContactWise API documentation](https://docs.contactwise.io/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
