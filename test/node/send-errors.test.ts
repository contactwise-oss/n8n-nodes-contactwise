import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { ContactWiseSms } from '../../nodes/ContactWiseSms/ContactWiseSms.node';
import {
	TEST_API_KEY,
	TEST_TENANT_ID,
	interceptSend,
	sendScenarios,
	type SendScenario,
} from '../fixtures/contactwise-api';
import { runNode } from '../harness/run-node';

// Behaviour per row of the error table in docs/contactwise-sms-api.md.
const parameters = {
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

function answer(...scenarios: SendScenario[]) {
	const intercepted = scenarios.map((scenario) => interceptSend(scenario));
	return () => intercepted.reduce((count, { requests }) => count + requests.length, 0);
}

function send(continueOnFail = false) {
	return runNode({
		node: new ContactWiseSms(),
		credentialTypes: [new ContactWiseApi()],
		credentials: {
			contactWiseApi: { apiKey: TEST_API_KEY, tenantId: TEST_TENANT_ID, defaultEntityId: '' },
		},
		parameters,
		continueOnFail,
	});
}

describe('ContactWise SMS: Send failures', () => {
	it('500: fails after one attempt, says the SMS may already have been sent, gives the trace ID', async () => {
		const requestCount = answer(sendScenarios.serverError('trace-777'), sendScenarios.accepted());

		const { error } = await send();

		expect(requestCount()).toBe(1);
		expect(error?.message).toMatch(/may already have been sent/);
		expect(error?.message).toContain('[item 0]');
		expect(error?.description).toContain('trace-777');
		expect(error).toMatchObject({ httpCode: '500' });
	});

	it.each([
		['network timeout', sendScenarios.networkTimeout()],
		['502', sendScenarios.badGateway()],
		['504', sendScenarios.gatewayTimeout()],
	])('%s: fails after one attempt and never suggests Retry on Fail', async (_name, scenario) => {
		const requestCount = answer(scenario, sendScenarios.accepted());

		const { error } = await send();

		expect(requestCount()).toBe(1);
		expect(error?.message).toMatch(/may already have been sent/);
		expect(`${error?.message} ${error?.description}`).not.toMatch(/retry on fail/i);
	});

	it('429: waits for Retry-After and succeeds on the next attempt', async () => {
		const requestCount = answer(
			sendScenarios.rateLimited(1),
			sendScenarios.accepted('msg-after-wait'),
		);

		const { items, error } = await send();

		expect(error).toBeUndefined();
		expect(requestCount()).toBe(2);
		expect(items[0].json.messageId).toBe('msg-after-wait');
	}, 10_000);

	it('503: gives up after 3 attempts with a clear message', async () => {
		const requestCount = answer(
			sendScenarios.unavailable(1),
			sendScenarios.unavailable(1),
			sendScenarios.unavailable(1),
			sendScenarios.accepted(),
		);

		const { error } = await send();

		expect(requestCount()).toBe(3);
		expect(error?.message).toMatch(/unavailable/);
		expect(error?.description).toContain('Nothing was sent');
	}, 10_000);

	it('429 with a Retry-After beyond the 60 s budget fails without waiting', async () => {
		const requestCount = answer(sendScenarios.rateLimited(120), sendScenarios.accepted());

		const { error } = await send();

		expect(requestCount()).toBe(1);
		expect(error?.message).toMatch(/limiting/);
	});

	it('401: fails with the credential message', async () => {
		answer(sendScenarios.unauthorized());

		const { error } = await send();

		expect(error?.message).toContain(
			"The 'API Key' is invalid, or it doesn't belong to this tenant",
		);
	});

	it('400 with Continue On Fail: an error item with every code and message, keeping pairedItem', async () => {
		answer(sendScenarios.validationErrors());

		const { items, error } = await send(true);

		expect(error).toBeUndefined();
		expect(items).toHaveLength(1);
		expect(items[0].pairedItem).toEqual({ item: 0 });
		expect(items[0].json.error).toEqual(expect.stringContaining('Sender ID is not registered'));
		expect(items[0].json.errorDetails).toEqual({
			httpStatus: 400,
			outcome: 'not-sent',
			codes: [9002, 9008],
			messages: ['Sender ID is not registered', 'Message body does not match the template'],
			description: expect.stringContaining("'Sender ID'"),
		});
	});

	it.each([
		['500', sendScenarios.serverError()],
		['network timeout', sendScenarios.networkTimeout()],
		['401', sendScenarios.unauthorized()],
	])('%s: the API key never appears in the error output', async (_name, scenario) => {
		answer(scenario);
		const thrown = await send();
		answer(scenario);
		const continued = await send(true);

		const serialized = JSON.stringify({
			thrown: thrown.error,
			items: continued.items as IDataObject[],
		});
		expect(serialized).not.toContain(TEST_API_KEY);
	});
});
