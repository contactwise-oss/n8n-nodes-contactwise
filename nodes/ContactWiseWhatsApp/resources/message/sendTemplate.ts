import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { postMessage, resolveSender } from './common';
import { CURRENCY_CODES } from '../../shared/currencies';

const showForSendTemplate = { show: { resource: ['message'], operation: ['sendTemplate'] } };

/** A template parameter: one value filling a `{{n}}` placeholder. */
const parameterValues: INodeProperties[] = [
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		options: [
			{ name: 'Currency', value: 'currency' },
			{ name: 'Date Time', value: 'date_time' },
			{ name: 'Text', value: 'text' },
		],
		default: 'text',
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		default: '',
		displayOptions: { show: { type: ['text'] } },
	},
	{
		displayName: 'Currency Code',
		name: 'currencyCode',
		type: 'options',
		options: CURRENCY_CODES.map((code) => ({ name: code, value: code })),
		default: 'INR',
		displayOptions: { show: { type: ['currency'] } },
	},
	{
		displayName: 'Amount',
		name: 'amount',
		type: 'number',
		default: 0,
		typeOptions: { numberPrecision: 3 },
		description: 'The amount, e.g. 1499.50',
		displayOptions: { show: { type: ['currency'] } },
	},
	{
		displayName: 'Fallback Value',
		name: 'fallbackValue',
		type: 'string',
		default: '',
		placeholder: 'e.g. ₹1,499.50',
		description: "The text shown if WhatsApp can't format the value for the recipient",
		displayOptions: { show: { type: ['currency', 'date_time'] } },
	},
];

const HEADER_MEDIA_TYPES = ['document', 'image', 'video'];

/** A header takes one parameter: any body type, or media. */
const headerParameterValues: INodeProperties[] = [
	{
		...parameterValues[0],
		options: [
			{ name: 'Currency', value: 'currency' },
			{ name: 'Date Time', value: 'date_time' },
			{ name: 'Document', value: 'document' },
			{ name: 'Image', value: 'image' },
			{ name: 'Text', value: 'text' },
			{ name: 'Video', value: 'video' },
		],
	},
	...parameterValues.slice(1),
	{
		displayName: 'Media Source',
		name: 'mediaSource',
		type: 'options',
		options: [
			{ name: 'Link', value: 'link' },
			{ name: 'Media ID', value: 'id' },
		],
		default: 'link',
		displayOptions: { show: { type: HEADER_MEDIA_TYPES } },
	},
	{
		displayName: 'Link',
		name: 'mediaLink',
		type: 'string',
		default: '',
		placeholder: 'e.g. https://example.com/image.jpg',
		displayOptions: { show: { type: HEADER_MEDIA_TYPES, mediaSource: ['link'] } },
	},
	{
		displayName: 'Media ID',
		name: 'mediaId',
		type: 'string',
		default: '',
		placeholder: 'e.g. 1000000000000004',
		displayOptions: { show: { type: HEADER_MEDIA_TYPES, mediaSource: ['id'] } },
	},
];

export const sendTemplateDescription: INodeProperties[] = [
	{
		displayName: 'Template',
		name: 'template',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'An approved template in your WhatsApp Business Account',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'getTemplates' },
			},
			{
				displayName: 'Name and Language',
				name: 'name',
				type: 'string',
				placeholder: 'e.g. order_update|en_US',
				hint: 'The template name and language code, separated by |',
			},
		],
		displayOptions: showForSendTemplate,
	},
	{
		displayName: 'Components',
		name: 'components',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Component',
		default: {},
		description: "Values for the template's placeholders, in the order the template uses them",
		displayOptions: showForSendTemplate,
		options: [
			{
				displayName: 'Component',
				name: 'component',
				// eslint-disable-next-line n8n-nodes-base/node-param-fixed-collection-type-unsorted-items -- Type decides which of the other fields show, so it goes first
				values: [
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						options: [
							{ name: 'Body', value: 'body' },
							{ name: 'Button', value: 'button' },
							{ name: 'Header', value: 'header' },
						],
						default: 'body',
					},
					{
						displayName: 'Button Index',
						name: 'buttonIndex',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 2 },
						default: 0,
						description: "The button's position in the template, starting at 0",
						displayOptions: { show: { type: ['button'] } },
					},
					{
						displayName: 'Button Type',
						name: 'buttonSubType',
						type: 'options',
						options: [
							{
								name: 'Quick Reply',
								value: 'quick_reply',
								description:
									"The 'Button Value' comes back to you when the recipient taps the button",
							},
							{
								name: 'URL',
								value: 'url',
								description: "The 'Button Value' is added to the end of the button's URL",
							},
						],
						default: 'quick_reply',
						displayOptions: { show: { type: ['button'] } },
					},
					{
						displayName: 'Button Value',
						name: 'buttonValue',
						type: 'string',
						default: '',
						placeholder: 'e.g. CONFIRM_42',
						displayOptions: { show: { type: ['button'] } },
					},
					{
						displayName: 'Parameter',
						name: 'headerParameters',
						type: 'fixedCollection',
						placeholder: 'Add Parameter',
						default: {},
						displayOptions: { show: { type: ['header'] } },
						options: [
							{ displayName: 'Parameter', name: 'parameter', values: headerParameterValues },
						],
					},
					{
						displayName: 'Parameters',
						name: 'bodyParameters',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						placeholder: 'Add Parameter',
						default: {},
						displayOptions: { show: { type: ['body'] } },
						options: [{ displayName: 'Parameter', name: 'parameter', values: parameterValues }],
					},
				],
			},
		],
	},
];

interface TemplateParameter {
	type: string;
	text?: string;
	mediaSource?: string;
	mediaLink?: string;
	mediaId?: string;
	currencyCode?: string;
	amount?: number;
	fallbackValue?: string;
}

interface Component {
	type: string;
	bodyParameters?: { parameter?: TemplateParameter[] };
	headerParameters?: { parameter?: TemplateParameter };
	buttonSubType?: string;
	buttonIndex?: number;
	buttonValue?: string;
}

/** One parameter in Meta's shape. Currency amounts go in thousandths (`amount_1000`). */
function toMetaParameter(parameter: TemplateParameter): IDataObject {
	switch (parameter.type) {
		case 'currency':
			return {
				type: 'currency',
				currency: {
					fallback_value: parameter.fallbackValue ?? '',
					code: parameter.currencyCode,
					amount_1000: Math.round((parameter.amount ?? 0) * 1000),
				},
			};
		case 'date_time':
			return { type: 'date_time', date_time: { fallback_value: parameter.fallbackValue ?? '' } };
		case 'document':
		case 'image':
		case 'video':
			return {
				type: parameter.type,
				[parameter.type]:
					parameter.mediaSource === 'id'
						? { id: parameter.mediaId }
						: { link: parameter.mediaLink },
			};
		default:
			return { type: 'text', text: parameter.text ?? '' };
	}
}

function toMetaComponent(component: Component): IDataObject {
	if (component.type === 'button') {
		const quickReply = component.buttonSubType !== 'url';
		const value = component.buttonValue ?? '';
		return {
			type: 'button',
			sub_type: quickReply ? 'quick_reply' : 'url',
			index: String(component.buttonIndex ?? 0),
			parameters: [
				quickReply ? { type: 'payload', payload: value } : { type: 'text', text: value },
			],
		};
	}
	const parameters =
		component.type === 'header'
			? [component.headerParameters?.parameter].filter(
					(parameter): parameter is TemplateParameter => parameter !== undefined,
				)
			: (component.bodyParameters?.parameter ?? []);
	return { type: component.type, parameters: parameters.map(toMetaParameter) };
}

/** Splits the 'Template' value `name|language`. */
function parseTemplate(
	this: IExecuteFunctions,
	value: string,
	itemIndex: number,
): { name: string; language: string } {
	const [name, language, ...rest] = value.split('|').map((part) => part.trim());
	if (!name || !language || rest.length > 0) {
		throw new NodeOperationError(
			this.getNode(),
			`'Template' must be a template name and language code: '${value}' [item ${itemIndex}]`,
			{
				description: `Pick the template from the list, or write it as name|language, e.g. ${name || 'order_update'}|en_US.`,
				itemIndex,
			},
		);
	}
	return { name, language };
}

/** Sends one approved template for the item at `itemIndex` and returns Meta's response. */
export async function sendTemplate(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const sender = await resolveSender.call(this, itemIndex);
	const templateValue = this.getNodeParameter('template', itemIndex, '', {
		extractValue: true,
	}) as string;
	const { name, language } = parseTemplate.call(this, templateValue, itemIndex);
	const components = (
		this.getNodeParameter('components', itemIndex, {}) as { component?: Component[] }
	).component;

	const template: IDataObject = { name, language: { code: language } };
	if (components?.length) template.components = components.map(toMetaComponent);

	return await postMessage.call(this, sender, 'template', template, itemIndex);
}
