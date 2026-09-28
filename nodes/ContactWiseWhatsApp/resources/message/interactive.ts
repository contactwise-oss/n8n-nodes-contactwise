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

/** Buttons and rows can be given as JSON from v1.2 (TIN-62). */
const V1_2 = { '@version': [{ _cnd: { gte: 1.2 } }] };

/** The fields for Message Type → Interactive, shown with `displayOptions` (v1.1 and later). */
export function interactiveDescription(displayOptions: IDisplayOptions): INodeProperties[] {
	const forType = (type: string): IDisplayOptions => ({
		show: { ...displayOptions.show, interactiveType: [type] },
	});
	/** Shows the fields in v1.1, and in v1.2 unless 'Using JSON' is picked. */
	const forFields = (type: string, modeParameter: string): IDisplayOptions => ({
		...forType(type),
		hide: { [modeParameter]: ['json'] },
	});
	const forMode = (type: string, modeParameter: string, mode: string): IDisplayOptions => ({
		show: { ...forType(type).show, ...V1_2, [modeParameter]: [mode] },
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
			displayName: 'Specify Buttons',
			name: 'buttonsInputMode',
			type: 'options',
			noDataExpression: true,
			options: [
				{ name: 'Using Fields Below', value: 'fields' },
				{
					name: 'Using JSON',
					value: 'json',
					description: 'Pass the buttons as data, for example from an AI Agent',
				},
			],
			default: 'fields',
			displayOptions: { show: { ...forType('button').show, ...V1_2 } },
		},
		{
			displayName: 'Buttons (JSON)',
			name: 'buttonsJson',
			type: 'json',
			required: true,
			default: '[\n  { "id": "yes", "title": "Yes" },\n  { "id": "no", "title": "No" }\n]',
			description:
				'An array of 1 to 3 buttons, each with an ID (up to 256 characters) and a title (up to 20 characters). Use an expression to pass the array from an earlier node, such as an AI Agent.',
			displayOptions: forMode('button', 'buttonsInputMode', 'json'),
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
			displayOptions: forFields('button', 'buttonsInputMode'),
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
			displayName: 'Specify Rows',
			name: 'rowsInputMode',
			type: 'options',
			noDataExpression: true,
			options: [
				{ name: 'Using Fields Below', value: 'fields' },
				{
					name: 'Using JSON',
					value: 'json',
					description: 'Pass the rows as data, for example from an AI Agent',
				},
			],
			default: 'fields',
			displayOptions: { show: { ...forType('list').show, ...V1_2 } },
		},
		{
			displayName: 'Rows (JSON)',
			name: 'rowsJson',
			type: 'json',
			required: true,
			default: '[\n  { "id": "timings", "title": "Timings", "description": "When we are open" }\n]',
			description:
				'An array of 1 to 10 rows, each with an ID (up to 200 characters), a title (up to 24 characters) and an optional description (up to 72 characters). Use an expression to pass the array from an earlier node, such as an AI Agent.',
			displayOptions: forMode('list', 'rowsInputMode', 'json'),
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
			displayOptions: forFields('list', 'rowsInputMode'),
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

interface InteractiveEntry {
	id: string;
	title: string;
	description?: string;
}

const JSON_FIELDS: Record<string, { field: string; example: string }> = {
	buttonsJson: {
		field: 'Buttons (JSON)',
		example: '[{ "id": "yes", "title": "Yes" }, { "id": "no", "title": "No" }]',
	},
	rowsJson: {
		field: 'Rows (JSON)',
		example: '[{ "id": "timings", "title": "Timings", "description": "When we are open" }]',
	},
};

/** Reads 'Buttons (JSON)' or 'Rows (JSON)': an array, or a JSON string of one. */
function jsonEntries(
	this: IExecuteFunctions,
	parameter: string,
	itemIndex: number,
): InteractiveEntry[] {
	const { field, example } = JSON_FIELDS[parameter];
	const fail = (problem: string): never => {
		throw new NodeOperationError(this.getNode(), `'${field}' ${problem} [item ${itemIndex}]`, {
			description: `Use an array like ${example}.`,
			itemIndex,
		});
	};

	let value = this.getNodeParameter(parameter, itemIndex);
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			fail("isn't valid JSON");
		}
	}
	if (!Array.isArray(value)) fail('must be an array');

	const entries = value as unknown[];
	entries.forEach((entry, index) => {
		const { id, title, description } = (entry ?? {}) as Record<string, unknown>;
		const valid =
			typeof id === 'string' &&
			id !== '' &&
			typeof title === 'string' &&
			title !== '' &&
			(description === undefined || typeof description === 'string');
		if (!valid) {
			fail(`entry ${index + 1} needs an "id" and a "title", both as text`);
		}
	});
	return entries as InteractiveEntry[];
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
		const { buttons = [] } =
			this.getNodeParameter('buttonsInputMode', itemIndex, 'fields') === 'json'
				? { buttons: jsonEntries.call(this, 'buttonsJson', itemIndex) }
				: (this.getNodeParameter('interactiveButtons', itemIndex, {}) as {
						buttons?: Array<{ id: string; title: string }>;
					});
		checkCount.call(this, 'Buttons', buttons.length, MAX_BUTTONS, itemIndex);
		interactive.action = {
			buttons: buttons.map(({ id, title }) => ({ type: 'reply', reply: { id, title } })),
		};
		return interactive;
	}

	const { rows = [] } =
		this.getNodeParameter('rowsInputMode', itemIndex, 'fields') === 'json'
			? { rows: jsonEntries.call(this, 'rowsJson', itemIndex) }
			: (this.getNodeParameter('listRows', itemIndex, {}) as {
					rows?: Array<{ id: string; title: string; description?: string }>;
				});
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
