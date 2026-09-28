import type {
	IDataObject,
	IDisplayOptions,
	IExecuteFunctions,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** Meta's limits for interactive messages (docs/contactwise-whatsapp-api.md, TIN-61). */
const MAX_BUTTONS = 3;
const MAX_ROWS = 10;

/** The fields for Message Type → Interactive, shown with `displayOptions` (v1.1 and later). */
export function interactiveDescription(displayOptions: IDisplayOptions): INodeProperties[] {
	const forType = (type: string): IDisplayOptions => ({
		show: { ...displayOptions.show, interactiveType: [type] },
	});
	return [
		{
			displayName: 'Interactive Type',
			name: 'interactiveType',
			type: 'options',
			noDataExpression: true,
			options: [
				{
					name: 'Buttons',
					value: 'button',
					description: 'Up to 3 reply buttons under the message',
				},
				{
					name: 'List',
					value: 'list',
					description: 'A menu button that opens a list of up to 10 rows',
				},
			],
			default: 'button',
			displayOptions,
		},
		{
			displayName: 'Body',
			name: 'interactiveBody',
			type: 'string',
			typeOptions: { rows: 4 },
			required: true,
			default: '',
			description: 'The message text: up to 1024 characters with buttons, or 4096 with a list',
			displayOptions,
		},
		{
			displayName: 'Buttons',
			name: 'interactiveButtons',
			type: 'fixedCollection',
			typeOptions: { multipleValues: true },
			placeholder: 'Add Button',
			default: {},
			description: 'Between 1 and 3 buttons',
			options: [
				{
					displayName: 'Button',
					name: 'buttons',
					values: [
						{
							displayName: 'ID',
							name: 'id',
							type: 'string',
							required: true,
							default: '',
							placeholder: 'e.g. timings',
							description:
								"Sent to the WhatsApp Trigger in 'interactive.button_reply' when the recipient taps the button. Up to 256 characters.",
						},
						{
							displayName: 'Title',
							name: 'title',
							type: 'string',
							required: true,
							default: '',
							placeholder: 'e.g. Show timings',
							description: 'The button text, up to 20 characters',
						},
					],
				},
			],
			displayOptions: forType('button'),
		},
		{
			displayName: 'Menu Button Text',
			name: 'listButtonText',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'e.g. Menu',
			description: 'The text of the button that opens the list, up to 20 characters',
			displayOptions: forType('list'),
		},
		{
			displayName: 'Rows',
			name: 'listRows',
			type: 'fixedCollection',
			typeOptions: { multipleValues: true },
			placeholder: 'Add Row',
			default: {},
			description: 'Between 1 and 10 rows in the list',
			options: [
				{
					displayName: 'Row',
					name: 'rows',
					values: [
						{
							displayName: 'Description',
							name: 'description',
							type: 'string',
							default: '',
							description: 'Shown under the title, up to 72 characters',
						},
						{
							displayName: 'ID',
							name: 'id',
							type: 'string',
							required: true,
							default: '',
							placeholder: 'e.g. timings',
							description:
								"Sent to the WhatsApp Trigger in 'interactive.list_reply' when the recipient picks the row. Up to 200 characters.",
						},
						{
							displayName: 'Title',
							name: 'title',
							type: 'string',
							required: true,
							default: '',
							placeholder: 'e.g. Talk to a person',
							description: 'The row text, up to 24 characters',
						},
					],
				},
			],
			displayOptions: forType('list'),
		},
	];
}

export interface InteractiveAdditionalFields {
	interactiveHeader?: string;
	interactiveFooter?: string;
	listSectionTitle?: string;
}

function checkCount(
	this: IExecuteFunctions,
	field: string,
	count: number,
	max: number,
	itemIndex: number,
): void {
	if (count >= 1 && count <= max) return;
	throw new NodeOperationError(
		this.getNode(),
		`'${field}' needs between 1 and ${max} entries, but has ${count} [item ${itemIndex}]`,
		{
			description:
				field === 'Buttons'
					? "Add between 1 and 3 buttons. For more options, set 'Interactive Type' to 'List'."
					: 'Add between 1 and 10 rows.',
			itemIndex,
		},
	);
}

/** Meta's `interactive` object for the item at `itemIndex`. */
export function interactiveContent(
	this: IExecuteFunctions,
	itemIndex: number,
	additionalFields: InteractiveAdditionalFields,
): IDataObject {
	const type = this.getNodeParameter('interactiveType', itemIndex) as string;
	const interactive: IDataObject = { type };
	if (additionalFields.interactiveHeader) {
		interactive.header = { type: 'text', text: additionalFields.interactiveHeader };
	}
	interactive.body = { text: this.getNodeParameter('interactiveBody', itemIndex) as string };
	if (additionalFields.interactiveFooter) {
		interactive.footer = { text: additionalFields.interactiveFooter };
	}

	if (type === 'button') {
		const { buttons = [] } = this.getNodeParameter('interactiveButtons', itemIndex, {}) as {
			buttons?: Array<{ id: string; title: string }>;
		};
		checkCount.call(this, 'Buttons', buttons.length, MAX_BUTTONS, itemIndex);
		interactive.action = {
			buttons: buttons.map(({ id, title }) => ({ type: 'reply', reply: { id, title } })),
		};
		return interactive;
	}

	const { rows = [] } = this.getNodeParameter('listRows', itemIndex, {}) as {
		rows?: Array<{ id: string; title: string; description?: string }>;
	};
	checkCount.call(this, 'Rows', rows.length, MAX_ROWS, itemIndex);
	const section: IDataObject = {};
	if (additionalFields.listSectionTitle) section.title = additionalFields.listSectionTitle;
	section.rows = rows.map(({ id, title, description }) => ({
		id,
		title,
		...(description && { description }),
	}));
	interactive.action = {
		button: this.getNodeParameter('listButtonText', itemIndex) as string,
		sections: [section],
	};
	return interactive;
}
