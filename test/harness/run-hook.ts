import { HookContext } from 'n8n-core';
import type {
	ICredentialDataDecryptedObject,
	ICredentialType,
	IDataObject,
	INodeParameters,
	INodeType,
	IWebhookData,
} from 'n8n-workflow';

import { createTestWorkflow } from './run-node';

export const TEST_WEBHOOK_ID = 'webhook-under-test';
export const WEBHOOK_BASE_URL = 'https://n8n.example.com/webhook';
export const WEBHOOK_TEST_BASE_URL = 'https://n8n.example.com/webhook-test';
/** The production URL n8n builds for a trigger's `default` webhook with path `webhook`. */
export const PRODUCTION_WEBHOOK_URL = `${WEBHOOK_BASE_URL}/${TEST_WEBHOOK_ID}/webhook`;
export const TEST_WEBHOOK_URL = `${WEBHOOK_TEST_BASE_URL}/${TEST_WEBHOOK_ID}/webhook`;

export type WebhookHook = 'checkExists' | 'create' | 'delete';

export interface RunHookOptions {
	node: INodeType;
	hook: WebhookHook;
	parameters: INodeParameters;
	/** The node's static data before the hook runs. */
	staticData?: IDataObject;
	workflowName?: string;
	/** "Listen for test event": n8n registers the `/webhook-test/` URL instead. */
	isTest?: boolean;
	credentialTypes?: ICredentialType[];
	credentials?: Record<string, ICredentialDataDecryptedObject>;
}

export interface RunHookResult {
	/** What the hook returned, when it didn't throw. */
	result?: boolean;
	error?: Error;
	/** The node's static data after the hook ran. */
	staticData: IDataObject;
}

/**
 * Seam L5: runs one of a trigger's `webhookMethods.default` hooks inside n8n-core's real
 * `HookContext`, as n8n does on workflow activation (`checkExists`, then `create`), deactivation
 * (`delete`) and "Listen for test event". HTTP must be faked with nock.
 */
export async function runHook(options: RunHookOptions): Promise<RunHookResult> {
	const { workflow, node, additionalData } = createTestWorkflow({
		...options,
		webhookId: TEST_WEBHOOK_ID,
		staticData: options.staticData ? { ...options.staticData } : undefined,
	});
	Object.assign(additionalData, {
		webhookBaseUrl: WEBHOOK_BASE_URL,
		webhookTestBaseUrl: WEBHOOK_TEST_BASE_URL,
	});

	const webhookData = options.isTest
		? ({ isTest: true, webhookDescription: { name: 'default' } } as unknown as IWebhookData)
		: undefined;
	const context = new HookContext(
		workflow,
		node,
		additionalData,
		options.isTest ? 'manual' : 'trigger',
		options.isTest ? 'manual' : 'activate',
		webhookData,
	);

	const hook = options.node.webhookMethods?.default?.[options.hook];
	if (!hook) throw new Error(`The node has no webhookMethods.default.${options.hook}`);

	let result: boolean | undefined;
	let error: Error | undefined;
	try {
		result = await hook.call(context);
	} catch (caught) {
		error = caught as Error;
	}
	return { result, error, staticData: { ...workflow.getStaticData('node', node) } };
}
