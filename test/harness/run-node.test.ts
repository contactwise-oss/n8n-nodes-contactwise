import nock from 'nock';
import { describe, expect, it } from 'vitest';

import { ProbeApi, ProbeNode } from './probe-node';
import { runNode } from './run-node';

const BASE = 'https://api.example.test';

const run = (overrides: Partial<Parameters<typeof runNode>[0]> = {}) =>
	runNode({
		node: new ProbeNode(),
		credentialTypes: [new ProbeApi()],
		credentials: { probeApi: { apiKey: 'secret-key' } },
		parameters: { url: `${BASE}/echo`, value: '={{ $json.value }}', fullResponse: false },
		...overrides,
	});

describe('runNode harness (L2): executes a node in n8n-core with nock-faked HTTP', () => {
	it('injects the generic-auth credential header and resolves expressions per item', async () => {
		const seen: unknown[] = [];
		nock(BASE)
			.post('/echo')
			.times(2)
			.matchHeader('x-cw-api-key', 'secret-key')
			.reply(200, (_uri, body) => {
				seen.push(body);
				return { ok: true };
			});

		const { items, error } = await run({ input: [{ value: 'a' }, { value: 'b' }] });

		expect(error).toBeUndefined();
		expect(seen).toEqual([{ value: 'a' }, { value: 'b' }]);
		expect(items).toEqual([
			{ json: { ok: true }, pairedItem: { item: 0 } },
			{ json: { ok: true }, pairedItem: { item: 1 } },
		]);
	});

	it('stops the workflow with the node error when an item fails', async () => {
		nock(BASE).post('/echo').reply(500, { error: 'boom' });

		const { items, error } = await run();

		expect(items).toEqual([]);
		// n8n replaces a raw 500 with its generic message; the HTTP code survives.
		expect(error).toMatchObject({ httpCode: '500' });
	});

	it('turns a failure into an error item with pairedItem when continueOnFail is on', async () => {
		nock(BASE).post('/echo').reply(500, { error: 'boom' });
		nock(BASE).post('/echo').reply(200, { ok: true });

		const { items, error } = await run({
			continueOnFail: true,
			input: [{ value: 'x' }, { value: 'y' }],
		});

		expect(error).toBeUndefined();
		expect(items).toHaveLength(2);
		expect(items[0].json.error).toEqual(expect.any(String));
		expect(items[0].pairedItem).toEqual({ item: 0 });
		expect(items[1]).toEqual({ json: { ok: true }, pairedItem: { item: 1 } });
	});

	it('shares one n8n-workflow instance between n8n-core and node code (instanceof works)', async () => {
		nock(BASE).post('/echo').reply(401, '');

		const { items } = await run({ continueOnFail: true });

		// The NodeApiError is created by n8n-core's request helper and checked by the node.
		expect(items[0].json.isNodeApiError).toBe(true);
	});

	it('refuses any request no interceptor answers (network is closed)', async () => {
		const { error } = await run();

		expect(error?.message ?? '').not.toBe('');
		expect(nock.isDone()).toBe(true);
	});

	it('fails loudly when a credential type is missing from the harness', async () => {
		const { error } = await run({ credentials: {}, credentialTypes: [] });

		expect(error).toBeDefined();
	});
});
