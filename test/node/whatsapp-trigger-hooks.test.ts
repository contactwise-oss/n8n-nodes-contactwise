import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { ContactWiseWhatsAppTrigger } from '../../nodes/ContactWiseWhatsAppTrigger/ContactWiseWhatsAppTrigger.node';
import { TEST_API_KEY, TEST_TENANT_ID } from '../fixtures/contactwise-api';
import { interceptWebhooks, webhookScenarios, type Subscription } from '../fixtures/whatsapp-api';
import {
	PRODUCTION_WEBHOOK_URL,
	TEST_WEBHOOK_URL,
	runHook,
	type WebhookHook,
} from '../harness/run-hook';

// Seam L5: the hooks n8n calls on activation (checkExists, then create), on deactivation (delete)
// and around "Listen for test event". Expected requests come from the TIN-34 spec and contract.
const SUBSCRIPTION_ID = 'whs_8Jq2kP0x3vYtR9aLmN4bQw';
const SIGNING = 'whsec_3kd9Qm1vXb0y7ZtLpN8sR2cF5hJ6wA4eG9uK1oT3iYq';

const stored = { webhookId: SUBSCRIPTION_ID, webhookSecret: SIGNING };

const subscription = (overrides: Partial<Subscription> = {}): Subscription => ({
	id: SUBSCRIPTION_ID,
	url: PRODUCTION_WEBHOOK_URL,
	fields: ['messages'],
	description: 'Support inbox',
	status: 'active',
	...overrides,
});

function hook(
	name: WebhookHook,
	{
		parameters = {},
		staticData,
		isTest,
		workflowName = 'Support inbox',
	}: {
		parameters?: IDataObject;
		staticData?: IDataObject;
		isTest?: boolean;
		workflowName?: string;
	} = {},
) {
	return runHook({
		node: new ContactWiseWhatsAppTrigger(),
		hook: name,
		parameters: { updates: ['messages'], options: {}, ...parameters },
		staticData,
		isTest,
		workflowName,
		credentialTypes: [new ContactWiseApi()],
		credentials: { contactWiseApi: { apiKey: TEST_API_KEY, tenantId: TEST_TENANT_ID } },
	});
}

describe('ContactWise WhatsApp Trigger: checkExists', () => {
	it('returns false without calling the API when nothing is stored', async () => {
		const { result, error } = await hook('checkExists');

		expect(error).toBeUndefined();
		expect(result).toBe(false);
	});

	it('returns true when the stored subscription is listed, active, for this URL and these fields', async () => {
		const { requests } = interceptWebhooks(
			'get',
			undefined,
			webhookScenarios.listed([subscription({ id: 'whs_other' }), subscription()]),
		);

		const { result, staticData } = await hook('checkExists', { staticData: stored });

		expect(result).toBe(true);
		expect(staticData).toEqual(stored);
		expect(requests[0].headers['x-cw-api-key']).toBe(TEST_API_KEY);
	});

	it('treats a disabled subscription as absent: deletes it and forgets it', async () => {
		interceptWebhooks(
			'get',
			undefined,
			webhookScenarios.listed([subscription({ status: 'disabled' })]),
		);
		const deleted = interceptWebhooks('delete', SUBSCRIPTION_ID, webhookScenarios.deleted());

		const { result, staticData } = await hook('checkExists', { staticData: stored });

		expect(result).toBe(false);
		expect(deleted.scope.isDone()).toBe(true);
		expect(staticData).toEqual({});
	});

	it('returns false and forgets the subscription when it is no longer listed', async () => {
		interceptWebhooks(
			'get',
			undefined,
			webhookScenarios.listed([subscription({ id: 'whs_other' })]),
		);

		const { result, staticData } = await hook('checkExists', { staticData: stored });

		expect(result).toBe(false);
		expect(staticData).toEqual({});
	});

	it.each([
		['a different URL', { url: 'https://old.example.com/webhook/x/webhook' }],
		['different fields', { fields: ['messages', 'account_update'] }],
	])('replaces a subscription registered for %s', async (_name, overrides) => {
		interceptWebhooks('get', undefined, webhookScenarios.listed([subscription(overrides)]));
		const deleted = interceptWebhooks('delete', SUBSCRIPTION_ID, webhookScenarios.deleted());

		const { result, staticData } = await hook('checkExists', { staticData: stored });

		expect(result).toBe(false);
		expect(deleted.scope.isDone()).toBe(true);
		expect(staticData).toEqual({});
	});

	it('treats fields in another order as the same subscription', async () => {
		interceptWebhooks(
			'get',
			undefined,
			webhookScenarios.listed([subscription({ fields: ['account_update', 'messages'] })]),
		);

		const { result } = await hook('checkExists', {
			staticData: stored,
			parameters: { updates: ['messages', 'account_update'] },
		});

		expect(result).toBe(true);
	});

	it('replaces a listed subscription whose secret was lost', async () => {
		interceptWebhooks('get', undefined, webhookScenarios.listed([subscription()]));
		const deleted = interceptWebhooks('delete', SUBSCRIPTION_ID, webhookScenarios.deleted());

		const { result } = await hook('checkExists', { staticData: { webhookId: SUBSCRIPTION_ID } });

		expect(result).toBe(false);
		expect(deleted.scope.isDone()).toBe(true);
	});

	it('fails activation with a clear error when the API key is wrong', async () => {
		interceptWebhooks('get', undefined, webhookScenarios.invalidKey());

		const { error } = await hook('checkExists', { staticData: stored });

		expect(error?.message).toBe("The 'API Key' is invalid, or it doesn't belong to this tenant");
	});
});

describe('ContactWise WhatsApp Trigger: create', () => {
	it("registers the workflow's webhook URL, fields and name, and stores the ID and secret", async () => {
		const { requests } = interceptWebhooks(
			'post',
			undefined,
			webhookScenarios.created(subscription({ fields: ['messages', 'account_update'] }), SIGNING),
		);

		const { result, staticData, error } = await hook('create', {
			parameters: { updates: ['messages', 'account_update'] },
		});

		expect(error).toBeUndefined();
		expect(result).toBe(true);
		expect(requests[0].body).toEqual({
			url: PRODUCTION_WEBHOOK_URL,
			fields: ['messages', 'account_update'],
			description: 'Support inbox',
		});
		expect(requests[0].headers['x-cw-api-key']).toBe(TEST_API_KEY);
		expect(staticData).toEqual(stored);
	});

	it('registers the test URL while listening for a test event', async () => {
		const { requests } = interceptWebhooks(
			'post',
			undefined,
			webhookScenarios.created(subscription({ url: TEST_WEBHOOK_URL }), SIGNING),
		);

		await hook('create', { isTest: true });

		expect((requests[0].body as IDataObject).url).toBe(TEST_WEBHOOK_URL);
	});

	it('cuts the description to the 200 characters ContactWise allows', async () => {
		const { requests } = interceptWebhooks(
			'post',
			undefined,
			webhookScenarios.created(subscription(), SIGNING),
		);

		await hook('create', { workflowName: 'x'.repeat(250) });

		expect((requests[0].body as IDataObject).description).toBe('x'.repeat(200));
	});

	it("surfaces ContactWise's reason when the URL is refused, and stores nothing", async () => {
		interceptWebhooks(
			'post',
			undefined,
			webhookScenarios.rejected("url host '10.0.0.5' resolves to a private address."),
		);

		const { error, staticData } = await hook('create');

		expect(error?.message).toBe(
			"ContactWise rejected the webhook registration: url host '10.0.0.5' resolves to a private address.",
		);
		expect((error as Error & { description?: string }).description).toBe(
			"No webhook was registered. Check ContactWise's response above, then activate the workflow again.",
		);
		expect(staticData).toEqual({});
	});

	it('surfaces the limit of 50 subscriptions', async () => {
		interceptWebhooks('post', undefined, webhookScenarios.limitReached());

		const { error } = await hook('create');

		expect(error?.message).toBe(
			'ContactWise rejected the webhook registration: This tenant already has 50 webhook subscriptions.',
		);
	});

	it('does not retry a rate-limited registration', async () => {
		const { scope } = interceptWebhooks('post', undefined, webhookScenarios.rateLimited());

		const { error } = await hook('create');

		expect(scope.isDone()).toBe(true);
		expect(error?.message).toBe('ContactWise is limiting how fast webhooks can be registered');
		expect((error as Error & { description?: string }).description).toBe(
			'No webhook was registered. Wait a few minutes and activate the workflow again.',
		);
	});

	it('fails when the response has no secret, since deliveries could never be verified', async () => {
		interceptWebhooks('post', undefined, { status: 201, body: subscription() });

		const { error, staticData } = await hook('create');

		expect(error?.message).toBe(
			"ContactWise's response didn't include the webhook's signing secret",
		);
		expect(staticData).toEqual({});
	});
});

describe('ContactWise WhatsApp Trigger: delete', () => {
	it('deletes the stored subscription and forgets it', async () => {
		const { scope, requests } = interceptWebhooks(
			'delete',
			SUBSCRIPTION_ID,
			webhookScenarios.deleted(),
		);

		const { result, staticData } = await hook('delete', { staticData: stored });

		expect(result).toBe(true);
		expect(scope.isDone()).toBe(true);
		expect(requests[0].headers['x-cw-api-key']).toBe(TEST_API_KEY);
		expect(staticData).toEqual({});
	});

	it('treats a 404 on a repeat delete as already deleted', async () => {
		interceptWebhooks('delete', SUBSCRIPTION_ID, webhookScenarios.notFound());

		const { result, error, staticData } = await hook('delete', { staticData: stored });

		expect(error).toBeUndefined();
		expect(result).toBe(true);
		expect(staticData).toEqual({});
	});

	it('returns true without calling the API when nothing is stored', async () => {
		const { result } = await hook('delete');

		expect(result).toBe(true);
	});

	it('returns false and keeps the subscription when the delete fails', async () => {
		interceptWebhooks('delete', SUBSCRIPTION_ID, { status: 500, body: {} });

		const { result, staticData } = await hook('delete', { staticData: stored });

		expect(result).toBe(false);
		expect(staticData).toEqual(stored);
	});
});
