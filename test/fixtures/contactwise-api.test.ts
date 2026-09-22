import { describe, expect, it } from 'vitest';

import { ProbeApi, ProbeNode } from '../harness/probe-node';
import { runNode } from '../harness/run-node';
import {
	CW_BASE_URL,
	TEST_API_KEY,
	interceptSend,
	sendPath,
	sendScenarios,
	type SendScenario,
} from './contactwise-api';

/** Sends one request through the real engine and returns the raw HTTP response it got. */
async function probe(scenario: SendScenario, fullResponse = true) {
	const intercepted = interceptSend(scenario);
	const result = await runNode({
		node: new ProbeNode(),
		credentialTypes: [new ProbeApi()],
		credentials: { probeApi: { apiKey: TEST_API_KEY } },
		parameters: { url: `${CW_BASE_URL}${sendPath()}`, value: 'hello', fullResponse },
		continueOnFail: true,
	});
	return { ...intercepted, json: result.items[0]?.json };
}

describe('ContactWise API fixtures (mirror docs/contactwise-sms-api.md)', () => {
	it('accepted: 200 with messageId, status and timestamp; records the request', async () => {
		const { json, requests, scope } = await probe(sendScenarios.accepted('msg-42'));

		expect(json).toMatchObject({
			statusCode: 200,
			body: { messageId: 'msg-42', status: 'accepted', timestamp: expect.any(String) },
		});
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toEqual({ value: 'hello' });
		expect(requests[0].headers['x-cw-api-key']).toBe(TEST_API_KEY);
		expect(scope.isDone()).toBe(true);
	});

	it.each([
		['validationErrors', sendScenarios.validationErrors(), 400, { errors: expect.any(Array) }],
		['problemDetails', sendScenarios.problemDetails(), 400, { errors: { $: expect.any(Array) } }],
		['serverError', sendScenarios.serverError('t-1'), 500, { traceId: 't-1' }],
	])(
		'%s reaches the node with the documented status and body',
		async (_name, scenario, status, body) => {
			const { json } = await probe(scenario);

			expect(json).toMatchObject({ statusCode: status, body });
		},
	);

	it.each([
		['rateLimited', sendScenarios.rateLimited(3), 429, 9010, '3'],
		['unavailable', sendScenarios.unavailable(7), 503, 9011, '7'],
	])(
		'%s carries its code and a Retry-After header',
		async (_name, scenario, status, code, retryAfter) => {
			const { json } = await probe(scenario);

			expect(json).toMatchObject({
				statusCode: status,
				headers: { 'retry-after': retryAfter },
				body: { errors: [{ code }] },
			});
		},
	);

	it.each([
		['unauthorized', sendScenarios.unauthorized(), 401],
		['badGateway', sendScenarios.badGateway(), 502],
		['gatewayTimeout', sendScenarios.gatewayTimeout(), 504],
	])('%s returns status %i with no JSON body', async (_name, scenario, status) => {
		const { json } = await probe(scenario);

		expect(json?.statusCode).toBe(status);
		expect(typeof json?.body).not.toBe('object');
	});

	it('networkTimeout fails the request itself', async () => {
		const { json } = await probe(sendScenarios.networkTimeout());

		// n8n's default text suggests "Retry on Fail", which is wrong for SMS; TIN-13 overrides it.
		expect(json?.error).toMatch(/timed out/i);
	});

	it('scripts sequences: interceptors answer in registration order', async () => {
		const first = interceptSend(sendScenarios.rateLimited(1));
		const second = interceptSend(sendScenarios.accepted());

		const result = await runNode({
			node: new ProbeNode(),
			credentialTypes: [new ProbeApi()],
			credentials: { probeApi: { apiKey: TEST_API_KEY } },
			parameters: {
				url: `${CW_BASE_URL}${sendPath()}`,
				value: '={{ $json.v }}',
				fullResponse: true,
			},
			input: [{ v: 'one' }, { v: 'two' }],
		});

		expect(result.items.map((item) => item.json.statusCode)).toEqual([429, 200]);
		expect([first.requests[0].body, second.requests[0].body]).toEqual([
			{ value: 'one' },
			{ value: 'two' },
		]);
	});
});
