import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

export class ContactWiseSms implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ContactWise SMS',
		name: 'contactWiseSms',
		icon: { light: 'file:../../icons/contactwise.svg', dark: 'file:../../icons/contactwise.dark.svg' },
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send DLT-compliant SMS to recipients in India with ContactWise',
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
		],
	};

	// Skeleton only: the Send operation is built test-first in TIN-12.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		throw new NodeOperationError(this.getNode(), 'The Send operation isn\'t available yet');
	}
}
