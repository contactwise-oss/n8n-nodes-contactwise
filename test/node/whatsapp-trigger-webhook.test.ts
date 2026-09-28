import { createHmac } from 'crypto';
import type { IDataObject, INodeParameters } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { ContactWiseWhatsAppTrigger } from '../../nodes/ContactWiseWhatsAppTrigger/ContactWiseWhatsAppTrigger.node';
import { runWebhook } from '../harness/run-webhook';

// Seam L4: a ContactWise delivery arriving at the trigger's webhook. Headers, signing and body
// shape come from the TIN-34 integration contract.
const SIGNING = 'whsec_3kd9Qm1vXb0y7ZtLpN8sR2cF5hJ6wA4eG9uK1oT3iYq';
const DELIVERY_ID = 'dlv_8_dZvztsSsZqRAMrlPSZzp';
const WABA_ID = '100000000000001';

const metadata = { display_phone_number: '15550001111', phone_number_id: '100000000000002' };

/** A delivery as ContactWise writes it: compact JSON, emoji as an escaped surrogate pair. */
const emojiDelivery = Buffer.from(
	`{"object":"whatsapp_business_account","entry":[{"id":"${WABA_ID}","time":1790000000,"changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":${JSON.stringify(metadata)},"contacts":[{"profile":{"name":"Asha"},"wa_id":"447700900123"}],"messages":[{"from":"447700900123","id":"wamid.in","type":"text","text":{"body":"Hi \\uD83D\\uDC4B"}}]}}]}]}`,
	'utf8',
);

const status = (value: string) => ({
	field: 'messages',
	value: {
		messaging_product: 'whatsapp',
		metadata,
		statuses: [{ id: `wamid.${value}`, status: value, recipient_id: '447700900123' }],
	},
});

const batchDelivery = Buffer.from(
	JSON.stringify({
		object: 'whatsapp_business_account',
		entry: [
			{
				id: WABA_ID,
				changes: [
					status('sent'),
					status('delivered'),
					{
						field: 'message_template_status_update',
						value: { event: 'APPROVED', message_template_id: 1, message_template_name: 'otp' },
					},
				],
			},
		],
	}),
	'utf8',
);

function signedHeaders(
	rawBody: Buffer,
	{
		secret = SIGNING,
		timestamp = Math.floor(Date.now() / 1000),
	}: { secret?: string; timestamp?: number } = {},
) {
	const signature =
		'sha256=' +
		createHmac('sha256', secret)
			.update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
			.digest('hex');
	return {
		'content-type': 'application/json',
		'user-agent': 'ContactWise-Webhooks/1.0',
		'x-cw-signature-256': signature,
		'x-cw-timestamp': String(timestamp),
		'x-cw-webhook-id': 'whs_8Jq2kP0x3vYtR9aLmN4bQw',
		'x-cw-delivery-id': DELIVERY_ID,
	};
}

function deliver(
	rawBody: Buffer,
	headers: Record<string, string>,
	{
		options = {},
		staticData = { webhookId: 'whs_8Jq2kP0x3vYtR9aLmN4bQw', webhookSecret: SIGNING },
		body,
	}: { options?: IDataObject; staticData?: IDataObject; body?: IDataObject } = {},
) {
	return runWebhook({
		node: new ContactWiseWhatsAppTrigger(),
		parameters: {
			updates: ['messages', 'message_template_status_update'],
			options: options as INodeParameters,
		},
		method: 'POST',
		rawBody,
		body,
		headers,
		staticData,
		credentialTypes: [new ContactWiseApi()],
		credentials: { contactWiseApi: { apiKey: 'k', tenantId: 't' } },
	});
}

function expectRejected({ result, response }: Awaited<ReturnType<typeof deliver>>) {
	expect(response.statusCode).toBe(401);
	expect(result.workflowData).toBeUndefined();
	expect(result.noWebhookResponse).toBe(true);
}

describe('ContactWise WhatsApp Trigger: deliveries', () => {
	it('starts the workflow with one item per change for a correctly signed delivery', async () => {
		const { result, response } = await deliver(emojiDelivery, signedHeaders(emojiDelivery));

		expect(response.statusCode).toBe(200);
		expect(result.workflowData).toEqual([
			[
				{
					json: {
						messaging_product: 'whatsapp',
						metadata,
						contacts: [{ profile: { name: 'Asha' }, wa_id: '447700900123' }],
						messages: [
							{ from: '447700900123', id: 'wamid.in', type: 'text', text: { body: 'Hi 👋' } },
						],
						field: 'messages',
						whatsAppBusinessAccountId: WABA_ID,
						deliveryId: DELIVERY_ID,
					},
				},
			],
		]);
	});

	it('verifies against the raw bytes, not the parsed body (emoji regression)', async () => {
		// n8n's parsed body re-serialises to different bytes; only the raw body verifies.
		const parsed = JSON.parse(emojiDelivery.toString('utf8')) as IDataObject;
		expect(Buffer.from(JSON.stringify(parsed)).equals(emojiDelivery)).toBe(false);

		const { response } = await deliver(emojiDelivery, signedHeaders(emojiDelivery), {
			body: parsed,
		});

		expect(response.statusCode).toBe(200);
	});

	it('emits one item per change for a multi-change batch', async () => {
		const { result } = await deliver(batchDelivery, signedHeaders(batchDelivery));

		expect(result.workflowData?.[0].map(({ json }) => json.field)).toEqual([
			'messages',
			'messages',
			'message_template_status_update',
		]);
	});

	it('applies the message status filter', async () => {
		const { result } = await deliver(batchDelivery, signedHeaders(batchDelivery), {
			options: { messageStatusUpdates: ['delivered'] },
		});

		expect(
			result.workflowData?.[0].map(({ json }) =>
				json.statuses ? (json.statuses as IDataObject[])[0].status : json.field,
			),
		).toEqual(['delivered', 'message_template_status_update']);
	});

	it('answers 200 and starts no workflow when the filter leaves nothing', async () => {
		const onlySent = Buffer.from(
			JSON.stringify({
				object: 'whatsapp_business_account',
				entry: [{ id: WABA_ID, changes: [status('sent')] }],
			}),
		);

		const { result, response } = await deliver(onlySent, signedHeaders(onlySent), {
			options: { messageStatusUpdates: ['read'] },
		});

		expect(response.statusCode).toBe(200);
		expect(result.workflowData).toBeUndefined();
		expect(result.noWebhookResponse).toBe(true);
	});

	it('rejects a delivery older than 5 minutes with 401', async () => {
		const timestamp = Math.floor(Date.now() / 1000) - 301;

		expectRejected(await deliver(emojiDelivery, signedHeaders(emojiDelivery, { timestamp })));
	});

	it('rejects a tampered body with 401', async () => {
		const tampered = Buffer.from(emojiDelivery.toString('utf8').replace('Asha', 'Eve'));

		expectRejected(await deliver(tampered, signedHeaders(emojiDelivery)));
	});

	it('rejects a delivery signed with another secret with 401', async () => {
		expectRejected(
			await deliver(emojiDelivery, signedHeaders(emojiDelivery, { secret: 'whsec_other' })),
		);
	});

	it('rejects an unsigned delivery with 401', async () => {
		const headers = signedHeaders(emojiDelivery);
		delete (headers as Partial<typeof headers>)['x-cw-signature-256'];

		expectRejected(await deliver(emojiDelivery, headers));
	});

	it('rejects every delivery with 401 when no secret is stored', async () => {
		expectRejected(await deliver(emojiDelivery, signedHeaders(emojiDelivery), { staticData: {} }));
	});

	it('rejects a delivery with 401 when n8n kept no raw body', async () => {
		const result = await runWebhook({
			node: new ContactWiseWhatsAppTrigger(),
			parameters: { updates: ['messages'], options: {} },
			method: 'POST',
			body: JSON.parse(emojiDelivery.toString('utf8')) as IDataObject,
			headers: signedHeaders(emojiDelivery),
			staticData: { webhookSecret: SIGNING },
		});

		expectRejected(result);
	});
});
