import { describe, expect, it } from 'vitest';

import {
	isLinkPreviewBot,
	parseFormResponse,
	renderConfirmPage,
	renderFormPage,
	type ResponseField,
} from '../../nodes/ContactWiseWhatsApp/shared/responsePage';

// TIN-43 decision (2026-09-25): the node serves its own self-contained page. Every value is
// HTML-escaped, and there's no JavaScript and no external asset.
const hostile = `<script>alert("x")</script> & 'quotes'`;

describe('response pages', () => {
	it('escape every text they show, and carry no script or external asset', () => {
		const html = renderFormPage({
			title: hostile,
			description: hostile,
			buttonLabel: hostile,
			fields: [{ fieldLabel: hostile, fieldType: 'dropdown', fieldOptions: [hostile] }],
		});

		expect(html).not.toContain('<script>');
		expect(html).toContain(
			'&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;',
		);
		expect(html).not.toMatch(/<(script|link|img|iframe)\b/i);
		expect(html).not.toMatch(/https?:\/\//);
	});

	it('form: posts back to the same URL, one input per field, required fields marked', () => {
		const html = renderFormPage({
			title: 'Order 42',
			buttonLabel: 'Send',
			fields: [
				{ fieldLabel: 'Comment', fieldType: 'textarea', requiredField: true },
				{ fieldLabel: 'Quantity', fieldType: 'number' },
				{ fieldLabel: 'Email', fieldType: 'email' },
				{ fieldLabel: 'Deliver on', fieldType: 'date' },
				{ fieldLabel: 'Size', fieldType: 'dropdown', fieldOptions: ['S', 'M'] },
				{ fieldLabel: 'Gift wrap', fieldType: 'checkbox' },
			],
		});

		expect(html).toMatch(/<form method="post" action="">/);
		expect(html).toMatch(/<textarea[^>]*name="field-0"[^>]*required/);
		expect(html).toMatch(/<input[^>]*type="number"[^>]*name="field-1"/);
		expect(html).toMatch(/<input[^>]*type="email"[^>]*name="field-2"/);
		expect(html).toMatch(/<input[^>]*type="date"[^>]*name="field-3"/);
		expect(html).toMatch(/<select[^>]*name="field-4"/);
		expect(html).toContain('<option value="M">M</option>');
		expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="field-5"/);
		expect(html).toContain('>Send</button>');
	});

	it('confirm page: one button that posts back, so opening the link alone changes nothing', () => {
		const html = renderConfirmPage({ title: 'Approve order 42?', buttonLabel: 'Approve' });

		expect(html).toMatch(/<form method="post" action="">\s*<button[^>]*>Approve<\/button>/);
	});
});

describe('parseFormResponse', () => {
	const fields: ResponseField[] = [
		{ fieldLabel: 'Comment', fieldType: 'textarea', requiredField: true },
		{ fieldLabel: 'Quantity', fieldType: 'number' },
		{ fieldLabel: 'Size', fieldType: 'dropdown', fieldOptions: ['S', 'M'] },
		{ fieldLabel: 'Gift wrap', fieldType: 'checkbox' },
	];

	it('keys the answers by field label, with numbers as numbers and checkboxes as booleans', () => {
		expect(
			parseFormResponse(fields, {
				'field-0': 'Leave at door',
				'field-1': '3',
				'field-2': 'M',
				'field-3': 'on',
			}),
		).toEqual({
			ok: true,
			data: { Comment: 'Leave at door', Quantity: 3, Size: 'M', 'Gift wrap': true },
		});
	});

	it('an unticked checkbox is false, and empty optional fields are left out', () => {
		expect(parseFormResponse(fields, { 'field-0': 'Hi', 'field-1': '' })).toEqual({
			ok: true,
			data: { Comment: 'Hi', 'Gift wrap': false },
		});
	});

	it('reports missing required fields and dropdown values that aren’t options', () => {
		expect(parseFormResponse(fields, { 'field-0': '  ', 'field-2': 'XL' })).toEqual({
			ok: false,
			invalid: ['Comment', 'Size'],
		});
	});
});

describe('isLinkPreviewBot', () => {
	it.each([
		'WhatsApp/2.24.8.78 A',
		'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
		'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
		'TelegramBot (like TwitterBot)',
		'Mozilla/5.0 (Windows NT 10.0) SkypeUriPreview Preview/0.5',
		'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
		'',
	])('%s is a bot', (userAgent) => {
		expect(isLinkPreviewBot(userAgent)).toBe(true);
	});

	it.each([
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
	])('%s is a person', (userAgent) => {
		expect(isLinkPreviewBot(userAgent)).toBe(false);
	});
});
