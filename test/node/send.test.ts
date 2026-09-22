import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { ContactWiseSms } from '../../nodes/ContactWiseSms/ContactWiseSms.node';
import {
	TEST_API_KEY,
	TEST_TENANT_ID,
	interceptSend,
	sendScenarios,
} from '../fixtures/contactwise-api';
import { runNode } from '../harness/run-node';

// Expected request/response values come from docs/contactwise-sms-api.md, not the implementation.
const baseParameters = {
	resource: 'sms',
	operation: 'send',
	senderId: 'CWDEMO',
	to: '9876543210',
	message: 'Your OTP is 123456',
	templateId: '1207161234567890123',
	entityId: '1201159143227331234',
	serviceType: 'transactional',
	options: {},
};

function send(
	overrides: {
		parameters?: IDataObject;
		credentials?: IDataObject;
		input?: IDataObject[];
		continueOnFail?: boolean;
	} = {},
) {
	return runNode({
		node: new ContactWiseSms(),
		credentialTypes: [new ContactWiseApi()],
		credentials: {
			contactWiseApi: {
				apiKey: TEST_API_KEY,
				tenantId: TEST_TENANT_ID,
				defaultEntityId: '',
				...overrides.credentials,
			},
		},
		parameters: { ...baseParameters, ...overrides.parameters },
		input: overrides.input,
		continueOnFail: overrides.continueOnFail,
	});
}

describe('ContactWise SMS: Send', () => {
	it('sends one SMS per item with the documented request body and returns the API result', async () => {
		const { requests } = interceptSend(sendScenarios.accepted('msg-42'));

		const { items, error } = await send();

		expect(error).toBeUndefined();
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toEqual({
			from: 'CWDEMO',
			to: '+919876543210',
			country: 'IN',
			body: 'Your OTP is 123456',
			templateId: '1207161234567890123',
			entityId: '1201159143227331234',
			messageType: 2,
			serviceType: 0,
			flash: false,
		});
		expect(requests[0].headers['x-cw-api-key']).toBe(TEST_API_KEY);
		expect(requests[0].headers['x-cw-source']).toMatch(/^n8n-nodes-contactwise\/\d+\.\d+\.\d+/);
		expect(items).toEqual([
			{
				json: {
					messageId: 'msg-42',
					status: 'accepted',
					timestamp: '2026-09-22T10:00:00Z',
					to: '+919876543210',
				},
				pairedItem: { item: 0 },
			},
		]);
	});

	it('makes one API call per input item, resolving expressions per item', async () => {
		const first = interceptSend(sendScenarios.accepted('msg-a'));
		const second = interceptSend(sendScenarios.accepted('msg-b'));
		const third = interceptSend(sendScenarios.accepted('msg-c'));

		const { items } = await send({
			parameters: { message: '={{ "Hello " + $json.name }}' },
			input: [{ name: 'Asha' }, { name: 'Ravi' }, { name: 'Meera' }],
		});

		expect([first, second, third].map(({ requests }) => requests[0].body)).toMatchObject([
			{ body: 'Hello Asha' },
			{ body: 'Hello Ravi' },
			{ body: 'Hello Meera' },
		]);
		expect(items.map(({ json, pairedItem }) => [json.messageId, pairedItem])).toEqual([
			['msg-a', { item: 0 }],
			['msg-b', { item: 1 }],
			['msg-c', { item: 2 }],
		]);
	});

	describe('Service Type and Options', () => {
		it("maps 'Promotional' to serviceType 1", async () => {
			const { requests } = interceptSend(sendScenarios.accepted());

			await send({ parameters: { serviceType: 'promotional' } });

			expect(requests[0].body).toMatchObject({ serviceType: 1 });
		});

		it.each([
			['auto', 2],
			['text', 0],
			['unicode', 1],
		])("maps 'Message Type' %s to messageType %i", async (messageType, code) => {
			const { requests } = interceptSend(sendScenarios.accepted());

			await send({ parameters: { options: { messageType } } });

			expect(requests[0].body).toMatchObject({ messageType: code });
		});

		it('sends Flash, Custom ID, Metadata and Callback URL, and echoes Custom ID in the output', async () => {
			const { requests } = interceptSend(sendScenarios.accepted('msg-7'));

			const { items } = await send({
				parameters: {
					options: {
						flash: true,
						customId: 'order-1001',
						metadata: {
							values: [
								{ name: 'orderId', value: '1001' },
								{ name: 'channel', value: 'n8n' },
							],
						},
						callbackUrl: 'https://example.com/dlr',
					},
				},
			});

			expect(requests[0].body).toMatchObject({
				flash: true,
				customId: 'order-1001',
				metadata: { orderId: '1001', channel: 'n8n' },
				callbackUrl: 'https://example.com/dlr',
			});
			expect(items[0].json).toMatchObject({ messageId: 'msg-7', customId: 'order-1001' });
		});

		it('fails the item without calling the API when Metadata has more than 10 pairs', async () => {
			const { requests } = interceptSend(sendScenarios.accepted());
			const values = Array.from({ length: 11 }, (_, n) => ({ name: `k${n}`, value: `v${n}` }));

			const { error } = await send({ parameters: { options: { metadata: { values } } } });

			expect(requests).toHaveLength(0);
			expect(error?.message).toContain("'Metadata'");
			expect(error?.message).toContain('11');
		});
	});

	describe("'To' validation", () => {
		it('fails the item without calling the API when the number is not an Indian mobile number', async () => {
			const { requests } = interceptSend(sendScenarios.accepted());

			const { error } = await send({ parameters: { to: '12345' } });

			expect(requests).toHaveLength(0);
			expect(error?.message).toContain("'To'");
			expect(error?.message).toContain('12345');
			expect(error?.description).toMatch(/10 digits/);
		});

		it('with Continue On Fail, reports the bad item and still sends the others', async () => {
			const { requests } = interceptSend(sendScenarios.accepted('msg-2'));

			const { items, error } = await send({
				parameters: { to: '={{ $json.phone }}' },
				input: [{ phone: 'not-a-number' }, { phone: '+91 91234 56789' }],
				continueOnFail: true,
			});

			expect(error).toBeUndefined();
			expect(requests).toHaveLength(1);
			expect(requests[0].body).toMatchObject({ to: '+919123456789' });
			expect(items[0].json.error).toEqual(expect.stringContaining('not-a-number'));
			expect(items[0].pairedItem).toEqual({ item: 0 });
			expect(items[1]).toMatchObject({ json: { messageId: 'msg-2' }, pairedItem: { item: 1 } });
		});
	});

	describe('DLT Entity ID precedence', () => {
		it("uses the node's 'DLT Entity ID' over the credential default", async () => {
			const { requests } = interceptSend(sendScenarios.accepted());

			await send({
				parameters: { entityId: 'NODE-ENTITY' },
				credentials: { defaultEntityId: 'CRED-ENTITY' },
			});

			expect(requests[0].body).toMatchObject({ entityId: 'NODE-ENTITY' });
		});

		it("falls back to the credential's 'Default Entity ID' when the node field is empty", async () => {
			const { requests } = interceptSend(sendScenarios.accepted());

			await send({ parameters: { entityId: '' }, credentials: { defaultEntityId: 'CRED-ENTITY' } });

			expect(requests[0].body).toMatchObject({ entityId: 'CRED-ENTITY' });
		});

		it('fails the item without calling the API when neither is set', async () => {
			const { requests } = interceptSend(sendScenarios.accepted());

			const { error } = await send({
				parameters: { entityId: '' },
				credentials: { defaultEntityId: '' },
			});

			expect(requests).toHaveLength(0);
			expect(error?.message).toContain("'DLT Entity ID'");
			expect(error?.description).toContain("'Default Entity ID'");
		});
	});
});
