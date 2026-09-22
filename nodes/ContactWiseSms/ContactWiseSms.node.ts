import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { send, sendDescription } from './resources/sms/send';
import type { SendFailure } from './shared/errors';
import { FAILURE_CONTEXT_KEY } from './shared/transport';

export class ContactWiseSms implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ContactWise SMS',
		name: 'contactWiseSms',
		icon: {
			light: 'file:../../icons/contactwise.svg',
			dark: 'file:../../icons/contactwise.dark.svg',
		},
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			"Send DLT-compliant SMS to recipients in India with ContactWise. Each run sends a real, billable SMS using a DLT-registered 'Sender ID', 'DLT Template ID' and 'DLT Entity ID'.",
		defaults: {
			name: 'ContactWise SMS',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'contactWiseApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'SMS',
						value: 'sms',
					},
				],
				default: 'sms',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['sms'],
					},
				},
				options: [
					{
						name: 'Send',
						value: 'send',
						description: 'Send an SMS to a recipient in India',
						action: 'Send SMS',
					},
				],
				default: 'send',
			},
			...sendDescription,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				returnData.push({ json: await send.call(this, i), pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					const failure =
						error instanceof NodeApiError
							? (error.context[FAILURE_CONTEXT_KEY] as SendFailure | undefined)
							: undefined;
					returnData.push({
						json: {
							error: (error as Error).message,
							...(failure && {
								errorDetails: {
									httpStatus: failure.httpStatus,
									outcome: failure.outcome,
									codes: failure.codes,
									messages: failure.messages,
									traceId: failure.traceId,
									description: failure.description,
								},
							}),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				// Re-wrapping an n8n error hands back the original instance, so nothing is lost.
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
