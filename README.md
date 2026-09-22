# @contactwise/n8n-nodes-contactwise

Send DLT-compliant SMS to recipients in India from your [n8n](https://n8n.io/) workflows and AI agents, using [ContactWise](https://docs.contactwise.io/).

- **ContactWise SMS › Send**: one SMS per input item, with the DLT sender, template and entity your business has registered.
- Numbers are normalized for you: `98765 43210`, `09876543210`, `919876543210` and `+91 98765-43210` are all sent as `+919876543210`.
- Failures say clearly whether the SMS was sent, so you never double-send by accident.

> **Status:** in development, not yet on npm. Phase 1 covers sending SMS to Indian numbers. Delivery-report triggers and WhatsApp are planned.

[Installation](#installation) · [Credentials](#credentials) · [Send an SMS](#send-an-sms) · [DLT in 60 seconds](#dlt-in-60-seconds) · [Output](#output) · [Delivery reports](#delivery-reports) · [When a send fails](#when-a-send-fails) · [AI agents](#using-it-as-an-ai-agent-tool) · [Examples](#example-workflows) · [Compatibility](#compatibility)

## Installation

**Self-hosted n8n:** go to **Settings › Community Nodes › Install**, enter `@contactwise/n8n-nodes-contactwise`, and confirm. See n8n's [community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

**n8n Cloud:** available from the nodes panel once n8n has verified the package.

## Credentials

Create a **ContactWise API** credential:

| Field | What to enter |
|---|---|
| API Key | Your ContactWise API key |
| Tenant ID | Your ContactWise tenant ID |
| Default Entity ID | *Optional.* Your DLT principal entity ID (PE ID). Used whenever a node's 'DLT Entity ID' is empty, so you don't repeat it on every node |

Don't have an API key or tenant ID? Contact ContactWise support.

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

Until a ContactWise trigger node ships, route delivery reports into n8n yourself:

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

## Using it as an AI agent tool

The node works as a tool for n8n's **AI Agent**. The agent can fill in fields such as 'To' and 'Message' with `$fromAI()` expressions.

Each call sends a real, billable SMS. Keep these fixed on the tool rather than left to the agent:
- 'Sender ID', 'DLT Template ID' and 'DLT Entity ID'
- enough of 'Message' that it still matches the template

Consider requiring human approval before the tool runs.

## Example workflows

Import these from the n8n editor (**⋯ › Import from File**). Then replace the sender ID and template ID with your registered values, and select your ContactWise API credential.

- [`examples/webhook-order-sms.json`](examples/webhook-order-sms.json): send an order confirmation when a webhook receives a new order. The order ID becomes the 'Custom ID'.
- [`examples/bulk-list-sms.json`](examples/bulk-list-sms.json): send to a list of recipients, one SMS each. It uses *On Error: Continue* so one bad number doesn't stop the rest.

## Compatibility

Built and tested against n8n 2.40. Requires an n8n version that supports community nodes. On n8n Cloud it also needs verification (pending).

## Resources

- [ContactWise API documentation](https://docs.contactwise.io/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
