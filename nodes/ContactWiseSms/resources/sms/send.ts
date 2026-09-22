import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { normalizeIndianMobile } from '../../shared/phone';
import { contactWiseApiRequest } from '../../shared/transport';

const showForSend = { show: { resource: ['sms'], operation: ['send'] } };

const SERVICE_TYPE_CODES: Record<string, number> = { transactional: 0, promotional: 1 };
const MESSAGE_TYPE_CODES: Record<string, number> = { text: 0, unicode: 1, auto: 2 };
const MAX_METADATA_PAIRS = 10;
/** Entry point recorded by the API, so messages sent through n8n can be counted (TIN-6). */
const REQUEST_SOURCE = 'n8n';

interface SendOptions {
	messageType?: string;
	flash?: boolean;
	customId?: string;
	metadata?: { values?: Array<{ name: string; value: string }> };
	callbackUrl?: string;
}

export const sendDescription: INodeProperties[] = [
	{
		displayName: 'Sender ID',
		name: 'senderId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. CWDEMO',
		description: 'DLT-registered sender ID the SMS is sent from',
		displayOptions: showForSend,
	},
	{
		displayName: 'To',
		name: 'to',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. +919876543210',
		description:
			'Recipient in India. Accepts 10 digits (starting 6–9), with or without 0, 91 or +91, and with spaces or dashes.',
		displayOptions: showForSend,
	},
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description:
			"Must match the content registered under 'DLT Template ID' exactly, with each {#var#} placeholder replaced by its value",
		displayOptions: showForSend,
	},
	{
		displayName: 'DLT Template ID',
		name: 'templateId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 1207161234567890123',
		description: "ID of the content registered on the DLT platform that 'Message' must match",
		displayOptions: showForSend,
	},
	{
		displayName: 'DLT Entity ID',
		name: 'entityId',
		type: 'string',
		default: '',
		placeholder: 'e.g. 1201159143227331234',
		description:
			"DLT principal entity ID. Leave empty to use the credential's 'Default Entity ID'.",
		displayOptions: showForSend,
	},
	{
		displayName: 'Service Type',
		name: 'serviceType',
		type: 'options',
		options: [
			{ name: 'Transactional', value: 'transactional' },
			{ name: 'Promotional', value: 'promotional' },
		],
		default: 'transactional',
		description: "Must match how 'DLT Template ID' is registered: transactional or promotional",
		displayOptions: showForSend,
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: showForSend,
		options: [
			{
				displayName: 'Callback URL',
				name: 'callbackUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/delivery-reports',
				description:
					'URL that receives delivery reports for this SMS, instead of your account-wide one. An n8n Webhook node URL works.',
			},
			{
				displayName: 'Custom ID',
				name: 'customId',
				type: 'string',
				default: '',
				placeholder: 'e.g. order-1001',
				description:
					'Your own value for this SMS, included in the output and echoed in delivery reports',
			},
			{
				displayName: 'Flash',
				name: 'flash',
				type: 'boolean',
				default: false,
				description:
					'Whether to send a flash SMS, shown on screen without being saved to the inbox',
			},
			{
				displayName: 'Message Type',
				name: 'messageType',
				type: 'options',
				options: [
					{ name: 'Auto', value: 'auto', description: 'Detect from the text' },
					{ name: 'Text', value: 'text', description: 'Plain text only (GSM characters)' },
					{
						name: 'Unicode',
						value: 'unicode',
						description: 'For Indian languages, emoji and other symbols',
					},
				],
				default: 'auto',
				description: 'Character set to send with. Auto picks the right one for the message.',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add pair',
				default: {},
				description: `Up to ${MAX_METADATA_PAIRS} name/value pairs returned in delivery reports`,
				options: [
					{
						name: 'values',
						displayName: 'Pair',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. orderId',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								placeholder: 'e.g. 1001',
							},
						],
					},
				],
			},
		],
	},
];

/** Sends one SMS for the item at `itemIndex` and returns the output item's JSON. */
export async function send(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const credentials = await this.getCredentials('contactWiseApi');
	const rawTo = this.getNodeParameter('to', itemIndex) as string;
	const to = normalizeIndianMobile(rawTo);
	if (!to.ok) {
		throw new NodeOperationError(
			this.getNode(),
			`The 'To' value '${rawTo}' isn't a valid number in India [item ${itemIndex}]`,
			{
				itemIndex,
				description:
					"Use 10 digits starting with 6, 7, 8 or 9, optionally prefixed with 0, 91 or +91, e.g. '+919876543210'.",
			},
		);
	}

	const entityId =
		((this.getNodeParameter('entityId', itemIndex) as string) || '').trim() ||
		((credentials.defaultEntityId as string) || '').trim();
	if (!entityId) {
		throw new NodeOperationError(
			this.getNode(),
			`Missing 'DLT Entity ID' for this SMS [item ${itemIndex}]`,
			{
				itemIndex,
				description:
					"Set 'DLT Entity ID' on this node, or 'Default Entity ID' in the ContactWise API credential.",
			},
		);
	}

	const options = this.getNodeParameter('options', itemIndex, {}) as SendOptions;
	const metadataPairs = options.metadata?.values ?? [];
	if (metadataPairs.length > MAX_METADATA_PAIRS) {
		throw new NodeOperationError(
			this.getNode(),
			`'Metadata' has ${metadataPairs.length} pairs; the limit is ${MAX_METADATA_PAIRS} [item ${itemIndex}]`,
			{ itemIndex, description: `Remove pairs so there are ${MAX_METADATA_PAIRS} or fewer.` },
		);
	}

	const body: IDataObject = {
		from: this.getNodeParameter('senderId', itemIndex) as string,
		to: to.value,
		country: 'IN',
		body: this.getNodeParameter('message', itemIndex) as string,
		templateId: this.getNodeParameter('templateId', itemIndex) as string,
		entityId,
		messageType: MESSAGE_TYPE_CODES[options.messageType ?? 'auto'],
		serviceType: SERVICE_TYPE_CODES[this.getNodeParameter('serviceType', itemIndex) as string],
		flash: options.flash ?? false,
		...(options.customId && { customId: options.customId }),
		...(metadataPairs.length > 0 && {
			metadata: Object.fromEntries(metadataPairs.map(({ name, value }) => [name, value])),
		}),
		...(options.callbackUrl && { callbackUrl: options.callbackUrl }),
		source: REQUEST_SOURCE,
	};

	const response = await contactWiseApiRequest.call(
		this,
		'POST',
		`/v1/sms/${credentials.tenantId as string}/send`,
		body,
		itemIndex,
	);

	return {
		messageId: response.messageId,
		status: response.status,
		timestamp: response.timestamp,
		to: to.value,
		...(options.customId && { customId: options.customId }),
	};
}
