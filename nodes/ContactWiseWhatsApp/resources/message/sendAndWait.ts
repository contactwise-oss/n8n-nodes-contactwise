import { NodeOperationError, SEND_AND_WAIT_OPERATION, WAIT_INDEFINITELY } from 'n8n-workflow';
import type {
	IExecuteFunctions,
	INodeProperties,
	IWebhookDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

import { postMessage, resolveSender } from './common';
import {
	RESPONSE_PAGE_CSP,
	isLinkPreviewBot,
	parseFormResponse,
	renderConfirmPage,
	renderFormPage,
	renderRecordedPage,
	type ResponseField,
	type ResponseFieldType,
} from '../../shared/responsePage';

const showForSendAndWait = {
	show: { resource: ['message'], operation: [SEND_AND_WAIT_OPERATION] },
};
const showForResponseType = (types: string[]) => ({
	show: { ...showForSendAndWait.show, responseType: types },
});

export const sendAndWaitDescription: INodeProperties[] = [
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'The text sent to the recipient, followed by one or two links to respond',
		displayOptions: showForSendAndWait,
	},
	{
		displayName: 'Response Type',
		name: 'responseType',
		type: 'options',
		options: [
			{
				name: 'Approval',
				value: 'approval',
				description:
					"The recipient approves, or chooses to approve or decline, based on 'Type of Approval'",
			},
			{
				name: 'Free Text',
				value: 'freeText',
				description: 'The recipient types a reply in a form',
			},
			{
				name: 'Custom Form',
				value: 'customForm',
				description: 'The recipient fills in a form with the fields you define',
			},
		],
		default: 'approval',
		displayOptions: showForSendAndWait,
	},
	{
		displayName: 'Form Fields',
		name: 'formFields',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Form Field',
		default: {},
		displayOptions: showForResponseType(['customForm']),
		options: [
			{
				displayName: 'Values',
				name: 'values',
				values: [
					{
						displayName: 'Dropdown Options',
						name: 'fieldOptions',
						type: 'string',
						default: '',
						placeholder: 'e.g. Small, Medium, Large',
						description: 'The choices, separated by commas',
						displayOptions: { show: { fieldType: ['dropdown'] } },
					},
					{
						displayName: 'Field Label',
						name: 'fieldLabel',
						type: 'string',
						default: '',
						placeholder: 'e.g. Quantity',
						description:
							'The label shown for the field, and used as the field name for the answer in the output',
					},
					{
						displayName: 'Field Type',
						name: 'fieldType',
						type: 'options',
						options: [
							{ name: 'Checkbox', value: 'checkbox' },
							{ name: 'Date', value: 'date' },
							{ name: 'Dropdown', value: 'dropdown' },
							{ name: 'Email', value: 'email' },
							{ name: 'Number', value: 'number' },
							{ name: 'Text', value: 'text' },
							{ name: 'Textarea', value: 'textarea' },
						],
						default: 'text',
					},
					{
						displayName: 'Required Field',
						name: 'requiredField',
						type: 'boolean',
						default: false,
						description: 'Whether the recipient must fill in the field',
						displayOptions: { hide: { fieldType: ['checkbox'] } },
					},
				],
			},
		],
	},
	{
		displayName: 'Approval Options',
		name: 'approvalOptions',
		type: 'fixedCollection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showForResponseType(['approval']),
		options: [
			{
				displayName: 'Values',
				name: 'values',
				values: [
					{
						displayName: 'Approve Button Label',
						name: 'approveLabel',
						type: 'string',
						default: 'Approve',
					},
					{
						displayName: 'Decline Button Label',
						name: 'disapproveLabel',
						type: 'string',
						default: 'Decline',
						displayOptions: { show: { approvalType: ['double'] } },
					},
					{
						displayName: 'Type of Approval',
						name: 'approvalType',
						type: 'options',
						options: [
							{ name: 'Approve Only', value: 'single' },
							{ name: 'Approve and Decline', value: 'double' },
						],
						default: 'single',
					},
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showForSendAndWait,
		options: [
			{
				displayName: 'Append Attribution',
				name: 'appendAttribution',
				type: 'boolean',
				default: true,
				description:
					"Whether to end the message with 'This message was sent automatically with n8n'",
			},
			{
				displayName: 'Form Button Label',
				name: 'responseFormButtonLabel',
				type: 'string',
				default: 'Submit',
				displayOptions: { show: { '/responseType': ['freeText', 'customForm'] } },
			},
			{
				displayName: 'Form Description',
				name: 'responseFormDescription',
				type: 'string',
				default: '',
				description: "Shown under 'Form Title'",
				displayOptions: { show: { '/responseType': ['freeText', 'customForm'] } },
			},
			{
				displayName: 'Form Title',
				name: 'responseFormTitle',
				type: 'string',
				default: '',
				description: "Shown at the top of the form. Leave empty to use 'Message'.",
				displayOptions: { show: { '/responseType': ['freeText', 'customForm'] } },
			},
			{
				displayName: 'Limit Wait Time',
				name: 'limitWaitTime',
				type: 'fixedCollection',
				default: {
					values: { limitType: 'afterTimeInterval', resumeAmount: 45, resumeUnit: 'minutes' },
				},
				description:
					'Whether to stop waiting after a while. The workflow then continues without a response.',
				options: [
					{
						displayName: 'Values',
						name: 'values',
						values: [
							{
								displayName: 'Amount',
								name: 'resumeAmount',
								type: 'number',
								typeOptions: { minValue: 0, numberPrecision: 2 },
								default: 1,
								displayOptions: { show: { limitType: ['afterTimeInterval'] } },
							},
							{
								displayName: 'Limit Type',
								name: 'limitType',
								type: 'options',
								options: [
									{
										name: 'After Time Interval',
										value: 'afterTimeInterval',
										description: 'Stop waiting after a set time',
									},
									{
										name: 'At Specified Time',
										value: 'atSpecifiedTime',
										description: 'Stop waiting at a set date and time',
									},
								],
								default: 'afterTimeInterval',
							},
							{
								displayName: 'Max Date and Time',
								name: 'maxDateAndTime',
								type: 'dateTime',
								default: '',
								displayOptions: { show: { limitType: ['atSpecifiedTime'] } },
							},
							{
								displayName: 'Unit',
								name: 'resumeUnit',
								type: 'options',
								options: [
									{ name: 'Minutes', value: 'minutes' },
									{ name: 'Hours', value: 'hours' },
									{ name: 'Days', value: 'days' },
								],
								default: 'hours',
								displayOptions: { show: { limitType: ['afterTimeInterval'] } },
							},
						],
					},
				],
			},
			{
				displayName: 'Response Link Label',
				name: 'messageButtonLabel',
				type: 'string',
				default: 'Respond',
				description: 'Shown above the link to the form in the message',
				displayOptions: { show: { '/responseType': ['freeText', 'customForm'] } },
			},
		],
	},
];

interface ApprovalOptions {
	approvalType?: 'single' | 'double';
	approveLabel?: string;
	disapproveLabel?: string;
}

interface LimitWaitTime {
	limitType?: 'afterTimeInterval' | 'atSpecifiedTime';
	resumeAmount?: number;
	resumeUnit?: 'minutes' | 'hours' | 'days';
	maxDateAndTime?: string;
}

interface SendAndWaitOptions {
	appendAttribution?: boolean;
	limitWaitTime?: { values?: LimitWaitTime };
	messageButtonLabel?: string;
	responseFormTitle?: string;
	responseFormDescription?: string;
	responseFormButtonLabel?: string;
}

type ResponseType = 'approval' | 'freeText' | 'customForm';

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

/** When to stop waiting: never, unless 'Limit Wait Time' is set. */
function waitTill(this: IExecuteFunctions, limit: LimitWaitTime | undefined): Date {
	if (!limit?.limitType) return WAIT_INDEFINITELY;
	const until =
		limit.limitType === 'atSpecifiedTime'
			? new Date(limit.maxDateAndTime ?? '')
			: new Date(Date.now() + (limit.resumeAmount ?? 0) * UNIT_MS[limit.resumeUnit ?? 'hours']);
	if (isNaN(until.getTime())) {
		throw new NodeOperationError(
			this.getNode(),
			"'Limit Wait Time' is missing a valid date and time",
			{
				description: "Set 'Max Date and Time', or switch 'Limit Type' to 'After Time Interval'.",
			},
		);
	}
	return until;
}

const ATTRIBUTION = 'This message was sent automatically with n8n: https://n8n.io';

/** The WhatsApp text: the message, then one labelled link per response option. */
function buildMessageText(this: IExecuteFunctions): string {
	const message = (this.getNodeParameter('message', 0, '') as string).trim();
	const approval = this.getNodeParameter('approvalOptions.values', 0, {}) as ApprovalOptions;
	const options = this.getNodeParameter('options', 0, {}) as SendAndWaitOptions;
	const responseType = this.getNodeParameter('responseType', 0, 'approval') as ResponseType;

	const approve = {
		label: approval.approveLabel || 'Approve',
		url: this.getSignedResumeUrl({ approved: 'true' }),
	};
	const links =
		responseType !== 'approval'
			? [{ label: options.messageButtonLabel || 'Respond', url: this.getSignedResumeUrl() }]
			: approval.approvalType === 'double'
				? [
						{
							label: approval.disapproveLabel || 'Decline',
							url: this.getSignedResumeUrl({ approved: 'false' }),
						},
						approve,
					]
				: [approve];
	// WhatsApp formatting: *bold* label, then the URL on its own line so it stays tappable.
	const linkText = links.map(({ label, url }) => `*${label}:*\n${url}`).join('\n\n');
	const attribution = options.appendAttribution === false ? '' : `\n\n${ATTRIBUTION}`;
	return `${message}\n\n${linkText}${attribution}`;
}

/**
 * Sends one message with response links for the whole execution (FR-W1), then puts the execution
 * to wait until the recipient responds through the resume webhook.
 */
export async function sendAndWait(this: IExecuteFunctions): Promise<void> {
	const sender = await resolveSender.call(this, 0);
	const options = this.getNodeParameter('options', 0, {}) as SendAndWaitOptions;
	// Checked before sending, so a bad setting never leaves a sent message with no usable wait.
	const until = waitTill.call(this, options.limitWaitTime?.values);
	const responseType = this.getNodeParameter('responseType', 0, 'approval') as ResponseType;
	const fieldLabels = (
		this.getNodeParameter('formFields.values', 0, []) as FormFieldParameter[]
	).map((field) => field.fieldLabel?.trim());
	if (
		responseType === 'customForm' &&
		(!fieldLabels.length || fieldLabels.some((label) => !label))
	) {
		throw new NodeOperationError(
			this.getNode(),
			"'Form Fields' needs at least one field, each with a label",
			{
				description: "Add a field under 'Form Fields' and give it a 'Field Label'.",
			},
		);
	}
	const text = buildMessageText.call(this);
	await postMessage.call(this, sender, 'text', { body: text, preview_url: false }, 0);

	await this.putExecutionToWait(until);
}

/** The resume URLs n8n registers while the execution waits (same shape as n8n's own nodes). */
export const sendAndWaitWebhooks: IWebhookDescription[] = (['GET', 'POST'] as const).map(
	(httpMethod) => ({
		name: 'default',
		httpMethod,
		responseMode: 'onReceived',
		responseData: '',
		path: '={{ $nodeId }}',
		restartWebhook: true,
		isFullPath: true,
	}),
);

function sendPage(this: IWebhookFunctions, html: string, status = 200): IWebhookResponseData {
	const response = this.getResponseObject();
	response.status(status);
	response.setHeader('Content-Type', 'text/html; charset=utf-8');
	response.setHeader('Content-Security-Policy', RESPONSE_PAGE_CSP);
	response.send(html);
	return { noWebhookResponse: true };
}

/** Records the answer and resumes the workflow. n8n sends the "recorded" page. */
function resume(this: IWebhookFunctions, data: Record<string, unknown>): IWebhookResponseData {
	this.getResponseObject().setHeader('Content-Security-Policy', RESPONSE_PAGE_CSP);
	return {
		webhookResponse: renderRecordedPage(),
		workflowData: [[{ json: { data: { ...data, respondedAt: new Date().toISOString() } } }]],
	};
}

interface FormFieldParameter {
	fieldLabel?: string;
	fieldType?: ResponseFieldType;
	requiredField?: boolean;
	fieldOptions?: string;
}

/** The fields the response form shows: one required box for free text, or the defined fields. */
function formFields(this: IWebhookFunctions, responseType: ResponseType): ResponseField[] {
	if (responseType === 'freeText') {
		return [{ fieldLabel: 'Response', fieldType: 'textarea', requiredField: true }];
	}
	const defined = this.getNodeParameter('formFields.values', []) as FormFieldParameter[];
	return defined.map((field) => ({
		fieldLabel: field.fieldLabel ?? '',
		fieldType: field.fieldType ?? 'text',
		requiredField: field.requiredField,
		fieldOptions: (field.fieldOptions ?? '')
			.split(',')
			.map((option) => option.trim())
			.filter(Boolean),
	}));
}

/** Free Text and Custom Form: GET shows the form, POST records the answers or shows what to fix. */
function formResponse(
	this: IWebhookFunctions,
	responseType: ResponseType,
	message: string,
): IWebhookResponseData {
	const options = this.getNodeParameter('options', {}) as SendAndWaitOptions;
	const fields = formFields.call(this, responseType);
	const form = (invalid?: string[]) =>
		renderFormPage({
			title: options.responseFormTitle || message,
			description: options.responseFormDescription,
			buttonLabel: options.responseFormButtonLabel || 'Submit',
			fields,
			invalid,
		});

	if (this.getRequestObject().method !== 'POST') return sendPage.call(this, form());

	const answer = parseFormResponse(fields, this.getBodyData());
	if (!answer.ok) return sendPage.call(this, form(answer.invalid), 400);
	return resume.call(
		this,
		responseType === 'freeText' ? { text: answer.data.Response } : answer.data,
	);
}

/**
 * Handles a recipient opening a response link. GET only ever shows a page; an answer is recorded
 * only when the page's form is submitted (POST), so link previews can't answer for the recipient.
 */
export async function sendAndWaitWebhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
	const request = this.getRequestObject();
	if (request.method === 'POST' && isLinkPreviewBot(request.headers['user-agent'])) {
		this.getResponseObject().send('');
		return { noWebhookResponse: true };
	}

	const message = (this.getNodeParameter('message', '') as string).trim();
	const responseType = this.getNodeParameter('responseType', 'approval') as ResponseType;
	if (responseType !== 'approval') return formResponse.call(this, responseType, message);

	const approval = this.getNodeParameter('approvalOptions.values', {}) as ApprovalOptions;
	const approved = (this.getQueryData() as { approved?: string }).approved === 'true';

	if (request.method === 'POST') return resume.call(this, { approved });
	return sendPage.call(
		this,
		renderConfirmPage({
			title: message,
			buttonLabel: approved
				? approval.approveLabel || 'Approve'
				: approval.disapproveLabel || 'Decline',
		}),
	);
}
