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
/** Flow messages arrived in v1.3 (TIN-63). */
const V1_3 = { '@version': [{ _cnd: { gte: 1.3 } }] };
/** Meta's `flow_action` values. 'Flow Action' can be an expression, so it's checked per item (TIN-67). */
const FLOW_ACTIONS = ['data_exchange', 'navigate'];

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
			displayOptions: { show: { ...displayOptions.show, '@version': [1.1, 1.2] } },
		},
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
					name: 'Flow',
					value: 'flow',
					description: 'A button that opens a WhatsApp Flow, a form inside the chat',
				},
				{
					name: 'List',
					value: 'list',
					description: 'A menu button that opens a list of up to 10 rows',
				},
			],
			default: 'button',
			displayOptions: { show: { ...displayOptions.show, ...V1_3 } },
		},
		{
			displayName: 'Body',
			name: 'interactiveBody',
			type: 'string',
			typeOptions: { rows: 4 },
			required: true,
			default: '',
			description:
				'The message text: up to 1024 characters with buttons or a Flow, or 4096 with a list',
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
		...flowDescription(forType('flow')),
	];
}

/** The fields for Interactive Type → Flow (v1.3 and later, TIN-63). */
function flowDescription(displayOptions: IDisplayOptions): INodeProperties[] {
	return [
		{
			displayName: 'Flow',
			name: 'flow',
			type: 'resourceLocator',
			default: { mode: 'id', value: '' },
			required: true,
			description: 'A Flow in your WhatsApp Business Account',
			modes: [
				{
					displayName: 'By ID',
					name: 'id',
					type: 'string',
					placeholder: 'e.g. 1000000000000005',
					hint: 'The Flow ID shown in WhatsApp Manager',
				},
				{
					displayName: 'By Name',
					name: 'name',
					type: 'string',
					placeholder: 'e.g. appointment_booking',
					hint: 'The Flow name, exactly as in WhatsApp Manager',
				},
			],
			displayOptions,
		},
		{
			displayName: 'Flow Button Text',
			name: 'flowButtonText',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'e.g. Book now',
			description: 'The text of the button that opens the Flow, up to 20 characters',
			displayOptions,
		},
		{
			displayName: 'Flow Token',
			// Not `flowToken`: the linter treats any name with 'token' as a password.
			name: 'flowCorrelation',
			type: 'string',
			default: '',
			placeholder: 'e.g. {{ $json.from }}-{{ $now.toMillis() }}',
			description:
				"Sent back to the WhatsApp Trigger with the recipient's answers, so you can match them to this message. Leave empty if you don't need it.",
			displayOptions,
		},
		{
			displayName: 'Flow Action',
			name: 'flowAction',
			type: 'options',
			options: [
				{
					name: 'Data Exchange',
					value: 'data_exchange',
					description: "The Flow's endpoint picks the first screen",
				},
				{
					name: 'Navigate',
					value: 'navigate',
					description: 'Open the Flow at a screen you choose',
				},
			],
			default: 'data_exchange',
			description:
				"How the Flow opens. To choose per item, use an expression that returns 'data_exchange' or 'navigate'.",
			displayOptions,
		},
		{
			displayName: 'Screen',
			name: 'flowScreen',
			type: 'string',
			// Shown for every Flow, not only Navigate: 'Flow Action' can be an expression, which the
			// editor resolves without item data. So it isn't `required` either; flowAction() checks it
			// for Navigate (TIN-67).
			default: '',
			placeholder: 'e.g. WELCOME',
			description:
				"The ID of the Flow's first screen. Required for Navigate, ignored for Data Exchange.",
			displayOptions,
		},
		{
			displayName: 'Screen Data (JSON)',
			name: 'flowScreenData',
			type: 'json',
			default: '{}',
			description:
				'Optional data for the first screen, as a JSON object, for example { "name": "Priya" }. Only used for Navigate.',
			displayOptions,
		},
	];
}

export interface InteractiveAdditionalFields {
	interactiveHeader?: string;
	interactiveFooter?: string;
	listSectionTitle?: string;
	flowDraftMode?: boolean;
}

/** Fails the item when a required text parameter is empty. */
function requireText(
	this: IExecuteFunctions,
	field: string,
	value: string,
	itemIndex: number,
): string {
	if (value.trim() !== '') return value;
	throw new NodeOperationError(this.getNode(), `'${field}' is empty [item ${itemIndex}]`, {
		description: `Enter a value for '${field}'.`,
		itemIndex,
	});
}

/** Reads 'Screen Data (JSON)': an object, a JSON string of one, or empty. */
function screenData(this: IExecuteFunctions, itemIndex: number): IDataObject | undefined {
	const fail = (problem: string): never => {
		throw new NodeOperationError(
			this.getNode(),
			`'Screen Data (JSON)' ${problem} [item ${itemIndex}]`,
			{ description: 'Use an object like { "name": "Priya" }, or leave it empty.', itemIndex },
		);
	};

	let value = this.getNodeParameter('flowScreenData', itemIndex, '{}');
	if (typeof value === 'string') {
		if (value.trim() === '') return undefined;
		try {
			value = JSON.parse(value);
		} catch {
			fail("isn't valid JSON");
		}
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		fail('must be an object');
	}
	const data = value as IDataObject;
	return Object.keys(data).length > 0 ? data : undefined;
}

/** Meta's `action` for a Flow message. */
function flowAction(
	this: IExecuteFunctions,
	itemIndex: number,
	additionalFields: InteractiveAdditionalFields,
): IDataObject {
	const flow = this.getNodeParameter('flow', itemIndex) as { mode: string; value: string };
	const flowValue = requireText.call(this, 'Flow', String(flow.value ?? ''), itemIndex);
	const parameters: IDataObject = {
		flow_message_version: '3',
		[flow.mode === 'name' ? 'flow_name' : 'flow_id']: flowValue,
		flow_cta: requireText.call(
			this,
			'Flow Button Text',
			this.getNodeParameter('flowButtonText', itemIndex) as string,
			itemIndex,
		),
	};
	const token = this.getNodeParameter('flowCorrelation', itemIndex, '') as string;
	if (token) parameters.flow_token = token;

	const action = requireText.call(
		this,
		'Flow Action',
		String(this.getNodeParameter('flowAction', itemIndex, 'data_exchange') ?? ''),
		itemIndex,
	);
	if (!FLOW_ACTIONS.includes(action)) {
		throw new NodeOperationError(
			this.getNode(),
			`'Flow Action' must be 'data_exchange' or 'navigate', but is '${action}' [item ${itemIndex}]`,
			{
				description:
					"Set 'Flow Action' to 'Data Exchange' or 'Navigate', or use an expression that returns 'data_exchange' or 'navigate'.",
				itemIndex,
			},
		);
	}
	parameters.flow_action = action;
	if (action === 'navigate') {
		const screen = requireText.call(
			this,
			'Screen',
			this.getNodeParameter('flowScreen', itemIndex, '') as string,
			itemIndex,
		);
		const data = screenData.call(this, itemIndex);
		parameters.flow_action_payload = { screen, ...(data && { data }) };
	}
	if (additionalFields.flowDraftMode) parameters.mode = 'draft';
	return { name: 'flow', parameters };
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

	if (type === 'flow') {
		interactive.action = flowAction.call(this, itemIndex, additionalFields);
		return interactive;
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
