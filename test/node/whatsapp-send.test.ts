import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { ContactWiseWhatsApp } from '../../nodes/ContactWiseWhatsApp/ContactWiseWhatsApp.node';
import { TEST_API_KEY, TEST_TENANT_ID } from '../fixtures/contactwise-api';
import {
	TEST_PHONE_NUMBER_ID,
	TEST_WABA_ID,
	interceptGateway,
	whatsAppScenarios,
} from '../fixtures/whatsapp-api';
import { runNode } from '../harness/run-node';

// Expected request and response values come from docs/contactwise-whatsapp-api.md.
const messagesPath = `${TEST_PHONE_NUMBER_ID}/messages`;

export const baseParameters = {
	resource: 'message',
	operation: 'send',
	phoneNumberId: { __rl: true, mode: 'id', value: TEST_PHONE_NUMBER_ID },
	recipientPhoneNumber: '+44 7700 900123',
	messageType: 'text',
	textBody: 'Hello from n8n',
	additionalFields: {},
};

export function sendWhatsApp(
	overrides: {
		parameters?: IDataObject;
		credentials?: IDataObject;
		input?: IDataObject[];
		inputItems?: INodeExecutionData[];
		continueOnFail?: boolean;
	} = {},
) {
	return runNode({
		node: new ContactWiseWhatsApp(),
		credentialTypes: [new ContactWiseApi()],
		credentials: {
			contactWiseApi: {
				apiKey: TEST_API_KEY,
				tenantId: TEST_TENANT_ID,
				defaultEntityId: '',
				whatsAppBusinessAccountId: TEST_WABA_ID,
				...overrides.credentials,
			},
		},
		parameters: { ...baseParameters, ...overrides.parameters },
		input: overrides.input,
		inputItems: overrides.inputItems,
		continueOnFail: overrides.continueOnFail,
	});
}

describe('ContactWise WhatsApp: Message → Send', () => {
	it('text: posts to the phone number ID through the gateway and outputs Meta’s response', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		const { items, error } = await sendWhatsApp();

		expect(error).toBeUndefined();
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '447700900123',
			type: 'text',
			text: { body: 'Hello from n8n', preview_url: false },
		});
		expect(requests[0].headers['x-cw-api-key']).toBe(TEST_API_KEY);
		expect(requests[0].headers['x-cw-source']).toMatch(/^n8n-nodes-contactwise\//);
		expect(items).toHaveLength(1);
		expect(items[0].json).toEqual({
			messaging_product: 'whatsapp',
			contacts: [{ input: '447700900123', wa_id: '447700900123' }],
			messages: [{ id: 'wamid.HBgLNDQ3NzAwOTAwMTIzFQIAERgSMA==' }],
		});
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});

	it('invalid recipient: fails the item with the parameter name and makes no API call', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		const { error } = await sendWhatsApp({ parameters: { recipientPhoneNumber: '1234567' } });

		expect(error?.message).toContain("'Recipient Phone Number'");
		expect(error?.message).toContain('[item 0]');
		expect(requests).toHaveLength(0);
	});

	it.each([
		[
			'image by link, with caption',
			{
				messageType: 'image',
				mediaSource: 'link',
				mediaLink: 'https://example.com/cat.jpg',
				additionalFields: { mediaCaption: 'A cat' },
			},
			{ type: 'image', image: { link: 'https://example.com/cat.jpg', caption: 'A cat' } },
		],
		[
			'video by media ID',
			{
				messageType: 'video',
				mediaSource: 'id',
				mediaId: '1000000000000004',
				additionalFields: {},
			},
			{ type: 'video', video: { id: '1000000000000004' } },
		],
		[
			'document by link, with caption and filename',
			{
				messageType: 'document',
				mediaSource: 'link',
				mediaLink: 'https://example.com/invoice.pdf',
				additionalFields: { mediaCaption: 'Your invoice', mediaFilename: 'invoice-42.pdf' },
			},
			{
				type: 'document',
				document: {
					link: 'https://example.com/invoice.pdf',
					caption: 'Your invoice',
					filename: 'invoice-42.pdf',
				},
			},
		],
		[
			// Meta doesn't support audio captions: a caption left over from another type is dropped.
			'audio by link, never with a caption',
			{
				messageType: 'audio',
				mediaSource: 'link',
				mediaLink: 'https://example.com/note.ogg',
				additionalFields: { mediaCaption: 'ignored' },
			},
			{ type: 'audio', audio: { link: 'https://example.com/note.ogg' } },
		],
	])('%s', async (_name, parameters, expected) => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		const { error } = await sendWhatsApp({ parameters });

		expect(error).toBeUndefined();
		expect(requests[0].body).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '447700900123',
			...expected,
		});
	});

	it('location: sends latitude, longitude, name and address', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		await sendWhatsApp({
			parameters: {
				messageType: 'location',
				latitude: 51.5007,
				longitude: -0.1246,
				additionalFields: { locationName: 'Big Ben', locationAddress: 'London SW1A 0AA' },
			},
		});

		expect(requests[0].body).toMatchObject({
			type: 'location',
			location: {
				latitude: 51.5007,
				longitude: -0.1246,
				name: 'Big Ben',
				address: 'London SW1A 0AA',
			},
		});
	});

	it('contacts: sends one contact card with its name, phones, emails, organisation, addresses, URLs and birthday', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		await sendWhatsApp({
			parameters: {
				messageType: 'contacts',
				contactFormattedName: 'Asha Rao',
				contactFields: {
					firstName: 'Asha',
					lastName: 'Rao',
					birthday: '1990-04-12',
					organization: {
						values: { company: 'ContactWise', department: 'Support', title: 'Lead' },
					},
					phones: { values: [{ phone: '+44 7700 900123', type: 'CELL', waId: '447700900123' }] },
					emails: { values: [{ email: 'asha@example.com', type: 'WORK' }] },
					urls: { values: [{ url: 'https://example.com', type: 'WORK' }] },
					addresses: {
						values: [
							{
								street: '1 High St',
								city: 'London',
								zip: 'SW1A 0AA',
								country: 'United Kingdom',
								countryCode: 'GB',
								type: 'WORK',
							},
						],
					},
				},
			},
		});

		expect(requests[0].body).toMatchObject({
			type: 'contacts',
			contacts: [
				{
					name: { formatted_name: 'Asha Rao', first_name: 'Asha', last_name: 'Rao' },
					birthday: '1990-04-12',
					org: { company: 'ContactWise', department: 'Support', title: 'Lead' },
					phones: [{ phone: '+44 7700 900123', type: 'CELL', wa_id: '447700900123' }],
					emails: [{ email: 'asha@example.com', type: 'WORK' }],
					urls: [{ url: 'https://example.com', type: 'WORK' }],
					addresses: [
						{
							street: '1 High St',
							city: 'London',
							zip: 'SW1A 0AA',
							country: 'United Kingdom',
							country_code: 'GB',
							type: 'WORK',
						},
					],
				},
			],
		});
	});

	it('contacts: a card with only the formatted name sends no empty fields', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		await sendWhatsApp({
			parameters: { messageType: 'contacts', contactFormattedName: 'Asha Rao', contactFields: {} },
		});

		expect((requests[0].body as { contacts: unknown }).contacts).toEqual([
			{ name: { formatted_name: 'Asha Rao' } },
		]);
	});

	describe('binary media', () => {
		const png = Buffer.from('fake-png-bytes');
		const itemWithImage: INodeExecutionData = {
			json: {},
			binary: {
				data: { data: png.toString('base64'), mimeType: 'image/png', fileName: 'cat.png' },
			},
		};

		it('uploads the item’s file as multipart, then sends the message by the returned media ID', async () => {
			const upload = interceptGateway(
				'post',
				`${TEST_PHONE_NUMBER_ID}/media`,
				whatsAppScenarios.mediaUploaded('777'),
			);
			const message = interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());

			const { error } = await sendWhatsApp({
				inputItems: [itemWithImage],
				parameters: {
					messageType: 'image',
					mediaSource: 'binary',
					binaryPropertyName: 'data',
					additionalFields: { mediaCaption: 'A cat' },
				},
			});

			expect(error).toBeUndefined();
			expect(upload.requests).toHaveLength(1);
			expect(String(upload.requests[0].headers['content-type'])).toMatch(
				/^multipart\/form-data; boundary=/,
			);
			const multipart = String(upload.requests[0].body);
			expect(multipart).toMatch(/name="messaging_product"\r\n\r\nwhatsapp/);
			expect(multipart).toMatch(/name="type"\r\n\r\nimage\/png/);
			expect(multipart).toMatch(/name="file"; filename="cat.png"/);
			expect(multipart).toContain('fake-png-bytes');
			expect(message.requests[0].body).toMatchObject({
				type: 'image',
				image: { id: '777', caption: 'A cat' },
			});
		});

		it('missing binary property: fails the item before any API call', async () => {
			const upload = interceptGateway(
				'post',
				`${TEST_PHONE_NUMBER_ID}/media`,
				whatsAppScenarios.mediaUploaded(),
			);

			const { error } = await sendWhatsApp({
				inputItems: [{ json: {} }],
				parameters: {
					messageType: 'image',
					mediaSource: 'binary',
					binaryPropertyName: 'data',
					additionalFields: {},
				},
			});

			expect(error?.message).toMatch(/data/);
			expect(upload.requests).toHaveLength(0);
		});
	});

	it("'Phone Number' picked from the list sends from that number's ID", async () => {
		const { requests } = interceptGateway(
			'post',
			'100000000000003/messages',
			whatsAppScenarios.messageAccepted(),
		);

		const { error } = await sendWhatsApp({
			parameters: { phoneNumberId: { __rl: true, mode: 'list', value: '100000000000003' } },
		});

		expect(error).toBeUndefined();
		expect(requests).toHaveLength(1);
	});

	describe('failures', () => {
		it('Meta rejection: stops with Meta’s reason, the item number and the specific fix', async () => {
			interceptGateway(
				'post',
				messagesPath,
				whatsAppScenarios.metaError(131047, 'Re-engagement message', {
					details:
						'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
				}),
			);

			const { error } = await sendWhatsApp();

			expect(error?.message).toBe('WhatsApp rejected the message: Re-engagement message [item 0]');
			expect(error?.description).toContain('Send an approved template instead.');
			expect(error?.description).not.toMatch(/SMS/);
		});

		it('Continue On Fail: outputs the error and its details, and carries on with the next item', async () => {
			interceptGateway(
				'post',
				messagesPath,
				whatsAppScenarios.metaError(131026, 'Message undeliverable'),
			);
			interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());

			const { items, error } = await sendWhatsApp({ input: [{}, {}], continueOnFail: true });

			expect(error).toBeUndefined();
			expect(items).toHaveLength(2);
			expect(items[0].json).toMatchObject({
				error: 'WhatsApp rejected the message: Message undeliverable [item 0]',
				errorDetails: {
					httpStatus: 400,
					outcome: 'not-sent',
					codes: [131026],
					traceId: 'AbCdEfGh123',
				},
			});
			expect(items[0].pairedItem).toEqual({ item: 0 });
			expect(items[1].json).toHaveProperty('messages');
		});

		it('500: says the message may already have been sent, and never retries', async () => {
			const { requests } = interceptGateway('post', messagesPath, whatsAppScenarios.serverError());
			interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());

			const { error } = await sendWhatsApp();

			expect(error?.message).toMatch(/^The WhatsApp message may already have been sent/);
			expect(requests).toHaveLength(1);
		});

		it('429 from the gateway: waits for Retry-After, then sends', async () => {
			const limited = interceptGateway('post', messagesPath, {
				status: 429,
				headers: { 'Retry-After': '0' },
				body: { error: { message: '(#130429) Rate limit hit', code: 130429 } },
			});
			const accepted = interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());

			const { error, items } = await sendWhatsApp();

			expect(error).toBeUndefined();
			expect(limited.requests).toHaveLength(1);
			expect(accepted.requests).toHaveLength(1);
			expect(items[0].json).toHaveProperty('messages');
		});
	});
});
