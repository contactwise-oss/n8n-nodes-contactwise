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

const inbound = {
	field: 'messages',
	value: {
		messaging_product: 'whatsapp',
		metadata,
		contacts: [{ profile: { name: 'Asha' }, wa_id: '447700900123' }],
		messages: [{ from: '447700900123', id: 'wamid.in', type: 'text', text: { body: 'Hi' } }],
	},
};

const templateUpdate = {
	field: 'message_template_status_update',
	value: { event: 'APPROVED', message_template_id: 1, message_template_name: 'otp' },
};

const delivery = (...changes: unknown[]) =>
	Buffer.from(
		JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: WABA_ID, changes }] }),
	);

/** A reply's statuses arriving in the same delivery as the next incoming message. */
const mixedDelivery = delivery(
	status('sent'),
	inbound,
	status('delivered'),
	status('read'),
	templateUpdate,
);

/** One label per item: the status for a status change, otherwise the field. */
const labels = (result: Awaited<ReturnType<typeof deliver>>['result']) =>
	result.workflowData?.[0].map(({ json }) =>
		json.statuses
			? (json.statuses as IDataObject[])[0].status
			: json.messages
				? 'message'
				: json.field,
	);

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
		typeVersion = 1,
		parameters = {
			updates: ['messages', 'message_template_status_update'],
			options: options as INodeParameters,
		},
	}: {
		options?: IDataObject;
		staticData?: IDataObject;
		body?: IDataObject;
		typeVersion?: number;
		parameters?: INodeParameters;
	} = {},
) {
	return runWebhook({
		node: new ContactWiseWhatsAppTrigger(),
		typeVersion,
		parameters,
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

	it('starts the workflow for every status when v1 has no status option set', async () => {
		const { result } = await deliver(mixedDelivery, signedHeaders(mixedDelivery));

		expect(labels(result)).toEqual([
			'sent',
			'message',
			'delivered',
			'read',
			'message_template_status_update',
		]);
	});

	describe('v1.1', () => {
		const v11 = (
			messageStatusUpdates?: string[],
			updates = ['messages', 'message_template_status_update'],
		) => ({
			typeVersion: 1.1,
			parameters: {
				updates,
				...(messageStatusUpdates && { messageStatusUpdates }),
			} as INodeParameters,
		});

		it('by default starts the workflow for incoming messages only, never for statuses', async () => {
			const { result } = await deliver(mixedDelivery, signedHeaders(mixedDelivery), v11());

			expect(labels(result)).toEqual(['message', 'message_template_status_update']);
		});

		it('answers 200 and starts no workflow for a delivery of statuses only', async () => {
			const onlyStatuses = delivery(status('sent'), status('delivered'), status('read'));

			const { result, response } = await deliver(onlyStatuses, signedHeaders(onlyStatuses), v11());

			expect(response.statusCode).toBe(200);
			expect(result.workflowData).toBeUndefined();
			expect(result.noWebhookResponse).toBe(true);
		});

		it('starts no workflow for statuses when none are selected', async () => {
			const { result } = await deliver(mixedDelivery, signedHeaders(mixedDelivery), v11([]));

			expect(labels(result)).toEqual(['message', 'message_template_status_update']);
		});

		it('starts the workflow only for the selected statuses', async () => {
			const { result } = await deliver(
				mixedDelivery,
				signedHeaders(mixedDelivery),
				v11(['read', 'failed']),
			);

			expect(labels(result)).toEqual(['message', 'read', 'message_template_status_update']);
		});

		it("starts the workflow for every status with 'All' next to other options", async () => {
			const { result } = await deliver(
				mixedDelivery,
				signedHeaders(mixedDelivery),
				v11(['sent', 'all']),
			);

			expect(labels(result)).toEqual([
				'sent',
				'message',
				'delivered',
				'read',
				'message_template_status_update',
			]);
		});

		it("ignores v1's Options setting", async () => {
			const { result } = await deliver(mixedDelivery, signedHeaders(mixedDelivery), {
				typeVersion: 1.1,
				parameters: {
					updates: ['messages', 'message_template_status_update'],
					options: { messageStatusUpdates: ['all'] },
				},
			});

			expect(labels(result)).toEqual(['message', 'message_template_status_update']);
		});

		it('starts the workflow for other events when Messages is not selected', async () => {
			const onlyTemplate = delivery(templateUpdate);

			const { result } = await deliver(
				onlyTemplate,
				signedHeaders(onlyTemplate),
				v11(undefined, ['message_template_status_update']),
			);

			expect(labels(result)).toEqual(['message_template_status_update']);
		});
	});

	describe('Flow submissions', () => {
		const CORRELATION = 'appt-447700900123';
		const answers = { flow_token: CORRELATION, date: '2026-10-02', slot: '10:30' };
		const flowReply = (response_json: string) => ({
			field: 'messages',
			value: {
				messaging_product: 'whatsapp',
				metadata,
				contacts: [{ profile: { name: 'Asha' }, wa_id: '447700900123' }],
				messages: [
					{
						from: '447700900123',
						id: 'wamid.flow',
						type: 'interactive',
						interactive: {
							type: 'nfm_reply',
							nfm_reply: { name: 'flow', body: 'Sent', response_json },
						},
					},
				],
			},
		});
		const submitted = delivery(flowReply(JSON.stringify(answers)));
		const at = (typeVersion: number) => ({
			typeVersion,
			parameters: { updates: ['messages'] } as INodeParameters,
		});
		const nfmReply = (result: Awaited<ReturnType<typeof deliver>>['result']) =>
			((result.workflowData?.[0][0].json.messages as IDataObject[])[0].interactive as IDataObject)
				.nfm_reply;

		it('adds the parsed answers next to response_json from v1.2', async () => {
			const { result } = await deliver(submitted, signedHeaders(submitted), at(1.2));

			expect(nfmReply(result)).toEqual({
				name: 'flow',
				body: 'Sent',
				response_json: JSON.stringify(answers),
				response: answers,
			});
		});

		it.each([1, 1.1])('leaves the answers as a string in v%s', async (typeVersion) => {
			const { result } = await deliver(submitted, signedHeaders(submitted), at(typeVersion));

			expect(nfmReply(result)).toEqual({
				name: 'flow',
				body: 'Sent',
				response_json: JSON.stringify(answers),
			});
		});

		it.each([
			['is not JSON', '{"flow_token": "appt-'],
			['is not a JSON object', '["appt-447700900123"]'],
		])('passes the message through unchanged when response_json %s', async (_, responseJson) => {
			const broken = delivery(flowReply(responseJson));

			const { result, response } = await deliver(broken, signedHeaders(broken), at(1.2));

			expect(response.statusCode).toBe(200);
			expect(nfmReply(result)).toEqual({ name: 'flow', body: 'Sent', response_json: responseJson });
		});

		it('leaves other messages in v1.2 unchanged', async () => {
			const { result } = await deliver(mixedDelivery, signedHeaders(mixedDelivery), at(1.2));

			expect(result.workflowData?.[0][0].json.messages).toEqual(inbound.value.messages);
		});
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
