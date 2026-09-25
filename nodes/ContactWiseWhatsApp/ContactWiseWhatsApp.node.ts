import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getPhoneNumbers, getTemplates } from './methods/listSearch';
import { senderAndRecipientDescription } from './resources/message/common';
import { send, sendDescription } from './resources/message/send';
import { sendTemplate, sendTemplateDescription } from './resources/message/sendTemplate';
import type { SendFailure } from '../shared/errors';
import { FAILURE_CONTEXT_KEY } from '../shared/transport';

export class ContactWiseWhatsApp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ContactWise WhatsApp',
		name: 'contactWiseWhatsApp',
		icon: {
			light: 'file:../../icons/contactwise.svg',
			dark: 'file:../../icons/contactwise.dark.svg',
		},
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Send WhatsApp messages through ContactWise, without needing your own Meta account or access token. Each run sends a real, billable WhatsApp message.',
		defaults: {
			name: 'ContactWise WhatsApp',
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
						name: 'Message',
						value: 'message',
					},
				],
				default: 'message',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				options: [
					{
						name: 'Send',
						value: 'send',
						description: 'Send a text, media, location or contact card to a WhatsApp user',
						action: 'Send message',
					},
					{
						name: 'Send Template',
						value: 'sendTemplate',
						description:
							'Send an approved template, the only kind of message allowed outside the 24-hour window',
						action: 'Send template message',
					},
				],
				default: 'send',
			},
			...senderAndRecipientDescription,
			...sendDescription,
			...sendTemplateDescription,
		],
	};

	methods = {
		listSearch: { getPhoneNumbers, getTemplates },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;
		const run = operation === 'sendTemplate' ? sendTemplate : send;

		for (let i = 0; i < items.length; i++) {
			try {
				returnData.push({ json: await run.call(this, i), pairedItem: { item: i } });
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
