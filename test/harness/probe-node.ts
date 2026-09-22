import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';
import type {
	IAuthenticateGeneric,
	ICredentialType,
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';

/**
 * Test-only credential with the same generic header auth as the ContactWise credential.
 * Lets the harness be proven before the real credential exists (TIN-8).
 */
export class ProbeApi implements ICredentialType {
	name = 'probeApi';

	displayName = 'Probe API';

	properties = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string' as const,
			typeOptions: { password: true },
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-CW-Api-Key': '={{$credentials.apiKey}}',
			},
		},
	};
}

/**
 * Test-only node: one authenticated POST per input item, following the canonical
 * programmatic pattern (pairedItem, continueOnFail, NodeApiError).
 */
export class ProbeNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Probe',
		name: 'probe',
		group: ['output'],
		version: 1,
		description: 'Test-only node for the harness',
		defaults: { name: 'Probe' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'probeApi', required: true }],
		properties: [
			{ displayName: 'URL', name: 'url', type: 'string', default: '' },
			{ displayName: 'Value', name: 'value', type: 'string', default: '' },
			{ displayName: 'Full Response', name: 'fullResponse', type: 'boolean', default: false },
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const fullResponse = this.getNodeParameter('fullResponse', i) as boolean;
				const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'probeApi', {
					method: 'POST',
					url: this.getNodeParameter('url', i) as string,
					body: { value: this.getNodeParameter('value', i) },
					json: true,
					returnFullResponse: fullResponse,
					ignoreHttpStatusErrors: fullResponse,
				})) as IDataObject;
				returnData.push({ json: response, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
							// Lets the harness prove n8n-core and node code share one n8n-workflow instance.
							isNodeApiError: error instanceof NodeApiError,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
