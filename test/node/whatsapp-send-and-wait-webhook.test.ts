import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { ContactWiseWhatsApp } from '../../nodes/ContactWiseWhatsApp/ContactWiseWhatsApp.node';
import { runWebhook } from '../harness/run-webhook';

// Seam L4: the resume URL the recipient opens. Opening a link (GET) only ever shows a page;
// an answer is recorded, and the workflow resumed, only by the page's form (POST). TIN-43 decision.
const baseParameters = {
	resource: 'message',
	operation: 'sendAndWait',
	message: 'Approve order #42?',
	responseType: 'approval',
	approvalOptions: {
		values: { approvalType: 'double', approveLabel: 'Ship it', disapproveLabel: 'Hold' },
	},
	options: {},
};

function callResumeUrl(
	method: 'GET' | 'POST',
	{
		parameters = {},
		query = {},
		body = {},
		headers = {},
	}: {
		parameters?: IDataObject;
		query?: Record<string, string>;
		body?: IDataObject;
		headers?: Record<string, string>;
	} = {},
) {
	return runWebhook({
		node: new ContactWiseWhatsApp(),
		parameters: { ...baseParameters, ...parameters },
		method,
		query,
		body,
		headers,
		credentialTypes: [new ContactWiseApi()],
		credentials: { contactWiseApi: { apiKey: 'k', tenantId: 't' } },
	});
}

describe('ContactWise WhatsApp: Send and Wait resume page (approval)', () => {
	it('opening the approve link shows a confirm page and does not resume the workflow', async () => {
		const { result, response } = await callResumeUrl('GET', { query: { approved: 'true' } });

		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(200);
		expect(response.headers['content-type']).toMatch(/^text\/html/);
		expect(response.headers['content-security-policy']).toContain("default-src 'none'");
		expect(response.body).toContain('Approve order #42?');
		expect(response.body).toMatch(/<button[^>]*>Ship it<\/button>/);
	});

	it('opening the decline link shows the decline label', async () => {
		const { response } = await callResumeUrl('GET', { query: { approved: 'false' } });

		expect(response.body).toMatch(/<button[^>]*>Hold<\/button>/);
	});

	it.each([
		['approve', 'true', true],
		['decline', 'false', false],
	])('confirming %s resumes the workflow with approved: %s', async (_name, approved, expected) => {
		const { result, response } = await callResumeUrl('POST', { query: { approved } });

		expect(result.workflowData).toEqual([
			[{ json: { data: { approved: expected, respondedAt: expect.any(String) } } }],
		]);
		expect(
			new Date(result.workflowData![0][0].json.data!['respondedAt' as never] as string).getTime(),
		).not.toBeNaN();
		// n8n sends `webhookResponse` itself, as for the official node; the CSP header is set first.
		expect(result.webhookResponse).toContain('Got it, thanks');
		expect(response.headers['content-security-policy']).toContain("default-src 'none'");
	});

	it('a link preview posting the form still records nothing', async () => {
		const { result, response } = await callResumeUrl('POST', {
			query: { approved: 'true' },
			headers: { 'user-agent': 'WhatsApp/2.24.8.78 A' },
		});

		expect(result).toEqual({ noWebhookResponse: true });
		expect(result.workflowData).toBeUndefined();
		expect(response.body ?? '').toBe('');
	});
});

describe('ContactWise WhatsApp: Send and Wait resume page (free text)', () => {
	const freeText = { responseType: 'freeText', options: { responseFormTitle: 'Delivery notes' } };

	it('opening the link shows a form with one required response box', async () => {
		const { result, response } = await callResumeUrl('GET', { parameters: freeText });

		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.body).toContain('<h1>Delivery notes</h1>');
		expect(response.body).toMatch(/<textarea[^>]*name="field-0"[^>]*required/);
		expect(response.headers['content-security-policy']).toContain("default-src 'none'");
	});

	it('submitting resumes the workflow with the text', async () => {
		const { result } = await callResumeUrl('POST', {
			parameters: freeText,
			body: { 'field-0': 'Ship Monday' },
		});

		expect(result.workflowData).toEqual([
			[{ json: { data: { text: 'Ship Monday', respondedAt: expect.any(String) } } }],
		]);
	});

	it('submitting an empty response shows the form again and does not resume', async () => {
		const { result, response } = await callResumeUrl('POST', {
			parameters: freeText,
			body: { 'field-0': ' ' },
		});

		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(400);
		expect(response.body).toContain('Check these fields: Response');
	});
});

describe('ContactWise WhatsApp: Send and Wait resume page (custom form)', () => {
	const customForm = {
		responseType: 'customForm',
		formFields: {
			values: [
				{ fieldLabel: 'Quantity', fieldType: 'number', requiredField: true },
				{ fieldLabel: 'Size', fieldType: 'dropdown', fieldOptions: 'S, M, L' },
			],
		},
		options: { responseFormButtonLabel: 'Place order' },
	};

	it('opening the link shows the defined fields', async () => {
		const { response } = await callResumeUrl('GET', { parameters: customForm });

		expect(response.body).toMatch(/<input[^>]*type="number"[^>]*name="field-0"[^>]*required/);
		expect(response.body).toContain('<option value="L">L</option>');
		expect(response.body).toContain('>Place order</button>');
	});

	it('submitting resumes the workflow with answers keyed by field label', async () => {
		const { result } = await callResumeUrl('POST', {
			parameters: customForm,
			body: { 'field-0': '2', 'field-1': 'M' },
		});

		expect(result.workflowData).toEqual([
			[{ json: { data: { Quantity: 2, Size: 'M', respondedAt: expect.any(String) } } }],
		]);
	});

	it('an invalid submission shows the form again with the fields to fix', async () => {
		const { result, response } = await callResumeUrl('POST', {
			parameters: customForm,
			body: { 'field-0': '', 'field-1': 'XL' },
		});

		expect(result.workflowData).toBeUndefined();
		expect(response.statusCode).toBe(400);
		expect(response.body).toContain('Check these fields: Quantity, Size');
	});
});
