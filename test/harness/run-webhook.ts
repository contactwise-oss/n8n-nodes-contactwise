import { WebhookContext } from 'n8n-core';
import type {
	ICredentialDataDecryptedObject,
	ICredentialType,
	IDataObject,
	INodeParameters,
	INodeType,
	IWebhookData,
	IWebhookResponseData,
} from 'n8n-workflow';

import { createTestWorkflow } from './run-node';

/** Records what a webhook sent straight to the HTTP response. */
export interface FakeResponse {
	statusCode: number;
	headers: Record<string, string>;
	body?: string;
	status(code: number): FakeResponse;
	setHeader(name: string, value: string): FakeResponse;
	send(body?: string): FakeResponse;
	end(body?: string): FakeResponse;
}

function fakeResponse(): FakeResponse {
	const response: FakeResponse = {
		statusCode: 200,
		headers: {},
		status(code) {
			response.statusCode = code;
			return response;
		},
		setHeader(name, value) {
			response.headers[name.toLowerCase()] = value;
			return response;
		},
		send(body) {
			response.body = body;
			return response;
		},
		end(body) {
			response.body = body ?? response.body;
			return response;
		},
	};
	return response;
}

export interface RunWebhookOptions {
	node: INodeType;
	parameters: INodeParameters;
	method: 'GET' | 'POST';
	query?: Record<string, string>;
	body?: IDataObject;
	headers?: Record<string, string>;
	credentialTypes?: ICredentialType[];
	credentials?: Record<string, ICredentialDataDecryptedObject>;
}

export interface RunWebhookResult {
	/** What `webhook()` returned: the resume data and any response for n8n to send. */
	result: IWebhookResponseData;
	/** What the node wrote to the HTTP response itself. */
	response: FakeResponse;
}

/**
 * Seam L4: runs a node's `webhook()` inside n8n-core's real `WebhookContext`, as n8n does when a
 * webhook (or a waiting execution's resume URL) is called. The request and response are fakes.
 */
export async function runWebhook(options: RunWebhookOptions): Promise<RunWebhookResult> {
	const { workflow, node, additionalData } = createTestWorkflow(options);
	const response = fakeResponse();
	Object.assign(additionalData, {
		httpRequest: {
			method: options.method,
			query: options.query ?? {},
			body: options.body ?? {},
			headers: {
				'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
				...options.headers,
			},
			params: {},
		},
		httpResponse: response,
	});

	const webhookData = {
		httpMethod: options.method,
		node: node.name,
		path: node.id,
		webhookDescription: {
			name: 'default',
			httpMethod: options.method,
			path: node.id,
			restartWebhook: true,
		},
		workflowId: workflow.id,
		workflowExecuteAdditionalData: additionalData,
	} as unknown as IWebhookData;

	const context = new WebhookContext(
		workflow,
		node,
		additionalData,
		'webhook',
		webhookData,
		[],
		null,
	);
	if (!options.node.webhook) throw new Error('The node has no webhook() method');
	const result = await options.node.webhook.call(context);
	return { result, response };
}
