import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	TEST_PHONE_NUMBER_ID,
	interceptGateway,
	whatsAppScenarios,
} from '../fixtures/whatsapp-api';
import { sendTemplateDescription } from '../../nodes/ContactWiseWhatsApp/resources/message/sendTemplate';
import { runWhatsApp } from './whatsapp-node';

// Expected bodies come from docs/contactwise-whatsapp-api.md and Meta's Cloud API reference for
// template messages: `template.name`, `template.language.code`, and `template.components[]`.
const messagesPath = `${TEST_PHONE_NUMBER_ID}/messages`;

const baseTemplateParameters = {
	resource: 'message',
	operation: 'sendTemplate',
	phoneNumberId: { __rl: true, mode: 'id', value: TEST_PHONE_NUMBER_ID },
	recipientPhoneNumber: '+44 7700 900123',
	template: { __rl: true, mode: 'list', value: 'order_update|en_US' },
	components: {},
};

function sendTemplate(parameters: IDataObject = {}) {
	return runWhatsApp({ base: baseTemplateParameters, parameters });
}

function templateOf(body: unknown) {
	return (body as { template: Record<string, unknown> }).template;
}

describe('ContactWise WhatsApp: Message → Send Template', () => {
	it("shows a component's Type before the fields that depend on it", () => {
		const components = sendTemplateDescription.find(({ name }) => name === 'components');
		const component = (components?.options as Array<{ values: Array<{ name: string }> }>)[0];

		expect(component.values[0].name).toBe('type');
	});

	it('sends the template name and language code, with no components when none are set', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		const { error, items } = await sendTemplate();

		expect(error).toBeUndefined();
		expect(requests[0].body).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '447700900123',
			type: 'template',
			template: { name: 'order_update', language: { code: 'en_US' } },
		});
		expect(items[0].json).toHaveProperty('messages');
	});

	it("'Name' mode takes 'name|language' too", async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		await sendTemplate({ template: { __rl: true, mode: 'name', value: 'otp_login|hi' } });

		expect(templateOf(requests[0].body)).toEqual({ name: 'otp_login', language: { code: 'hi' } });
	});

	it("a 'Template' value without a language fails the item before any API call", async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		const { error } = await sendTemplate({
			template: { __rl: true, mode: 'name', value: 'otp_login' },
		});

		expect(error?.message).toContain("'Template'");
		expect(error?.message).toContain('[item 0]');
		expect(error?.description).toContain('otp_login|en_US');
		expect(requests).toHaveLength(0);
	});

	it('body parameters: text, currency (amount × 1000) and date-time, in order', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		await sendTemplate({
			components: {
				component: [
					{
						type: 'body',
						bodyParameters: {
							parameter: [
								{ type: 'text', text: 'Asha' },
								{
									type: 'currency',
									currencyCode: 'INR',
									amount: 1499.5,
									fallbackValue: '₹1,499.50',
								},
								{ type: 'date_time', fallbackValue: '12 April 2026' },
							],
						},
					},
				],
			},
		});

		expect(templateOf(requests[0].body).components).toEqual([
			{
				type: 'body',
				parameters: [
					{ type: 'text', text: 'Asha' },
					{
						type: 'currency',
						currency: { fallback_value: '₹1,499.50', code: 'INR', amount_1000: 1499500 },
					},
					{ type: 'date_time', date_time: { fallback_value: '12 April 2026' } },
				],
			},
		]);
	});

	it.each([
		['text', { type: 'text', text: 'Order 42' }, { type: 'text', text: 'Order 42' }],
		[
			// The official node sends header currency raw, which Meta rejects.
			'currency, built like a body currency',
			{ type: 'currency', currencyCode: 'USD', amount: 20, fallbackValue: '$20.00' },
			{ type: 'currency', currency: { fallback_value: '$20.00', code: 'USD', amount_1000: 20000 } },
		],
		[
			'date-time, built like a body date-time',
			{ type: 'date_time', fallbackValue: 'Friday 3pm' },
			{ type: 'date_time', date_time: { fallback_value: 'Friday 3pm' } },
		],
		[
			'image by link',
			{ type: 'image', mediaSource: 'link', mediaLink: 'https://example.com/banner.png' },
			{ type: 'image', image: { link: 'https://example.com/banner.png' } },
		],
		[
			'document by media ID',
			{ type: 'document', mediaSource: 'id', mediaId: '1000000000000004' },
			{ type: 'document', document: { id: '1000000000000004' } },
		],
	])('header parameter: %s', async (_name, parameter, expected) => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		await sendTemplate({
			components: { component: [{ type: 'header', headerParameters: { parameter } }] },
		});

		expect(templateOf(requests[0].body).components).toEqual([
			{ type: 'header', parameters: [expected] },
		]);
	});

	it('buttons: quick reply with a payload and URL with a text suffix, each at its index', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		await sendTemplate({
			components: {
				component: [
					{
						type: 'button',
						buttonSubType: 'quick_reply',
						buttonIndex: 0,
						buttonValue: 'CONFIRM_42',
					},
					{ type: 'button', buttonSubType: 'url', buttonIndex: 1, buttonValue: 'orders/42' },
				],
			},
		});

		expect(templateOf(requests[0].body).components).toEqual([
			{
				type: 'button',
				sub_type: 'quick_reply',
				index: '0',
				parameters: [{ type: 'payload', payload: 'CONFIRM_42' }],
			},
			{
				type: 'button',
				sub_type: 'url',
				index: '1',
				parameters: [{ type: 'text', text: 'orders/42' }],
			},
		]);
	});

	it('132000 parameter mismatch: stops with the template fix', async () => {
		interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.metaError(
				132000,
				'Number of parameters does not match the expected number of params',
			),
		);

		const { error } = await sendTemplate();

		expect(error?.message).toContain('Number of parameters does not match');
		expect(error?.description).toContain('the parameters match it');
	});
});
