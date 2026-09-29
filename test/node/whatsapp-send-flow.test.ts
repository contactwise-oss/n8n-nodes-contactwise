import { describe, expect, it } from 'vitest';

import {
	TEST_PHONE_NUMBER_ID,
	interceptGateway,
	whatsAppScenarios,
} from '../fixtures/whatsapp-api';
import { runWhatsApp } from './whatsapp-node';

// Expected bodies come from the Flow section of docs/contactwise-whatsapp-api.md (TIN-63).
const messagesPath = `${TEST_PHONE_NUMBER_ID}/messages`;

const envelope = {
	messaging_product: 'whatsapp',
	recipient_type: 'individual',
	to: '447700900123',
	type: 'interactive',
};

const FLOW_ID = '1000000000000005';
/** A flow token, which isn't a secret: Meta returns it with the submitted answers. */
const CORRELATION = 'appt-447700900123';
const flowById = { __rl: true, mode: 'id', value: FLOW_ID };

function sendFlow(parameters: Record<string, unknown>, typeVersion?: number) {
	const intercepted = interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());
	const run = runWhatsApp({
		typeVersion,
		parameters: {
			messageType: 'interactive',
			interactiveType: 'flow',
			interactiveBody: 'Book your appointment in a few taps.',
			flow: flowById,
			flowButtonText: 'Book now',
			additionalFields: {},
			...parameters,
		},
	});
	return { intercepted, run };
}

describe('ContactWise WhatsApp: Message → Send, interactive Flow (v1.3)', () => {
	it('data exchange (the default): sends the Flow with no payload and no mode', async () => {
		const { intercepted, run } = sendFlow({});
		const { items, error } = await run;

		expect(error).toBeUndefined();
		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'flow',
				body: { text: 'Book your appointment in a few taps.' },
				action: {
					name: 'flow',
					parameters: {
						flow_message_version: '3',
						flow_id: FLOW_ID,
						flow_cta: 'Book now',
						flow_action: 'data_exchange',
					},
				},
			},
		});
		expect(items[0].json.messages).toEqual([{ id: 'wamid.HBgLNDQ3NzAwOTAwMTIzFQIAERgSMA==' }]);
	});

	it('navigate: sends the screen and its data, with header, footer, token and draft mode', async () => {
		const { intercepted, run } = sendFlow({
			flowCorrelation: CORRELATION,
			flowAction: 'navigate',
			flowScreen: 'APPOINTMENT',
			flowScreenData: '{ "department": "cardiology" }',
			additionalFields: {
				interactiveHeader: 'Thendral Hospital',
				interactiveFooter: 'Takes under a minute',
				flowDraftMode: true,
			},
		});
		const { error } = await run;

		expect(error).toBeUndefined();
		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'flow',
				header: { type: 'text', text: 'Thendral Hospital' },
				body: { text: 'Book your appointment in a few taps.' },
				footer: { text: 'Takes under a minute' },
				action: {
					name: 'flow',
					parameters: {
						flow_message_version: '3',
						flow_id: FLOW_ID,
						flow_cta: 'Book now',
						flow_token: CORRELATION,
						flow_action: 'navigate',
						flow_action_payload: { screen: 'APPOINTMENT', data: { department: 'cardiology' } },
						mode: 'draft',
					},
				},
			},
		});
	});

	it('navigate: leaves out empty screen data, and accepts it as an object', async () => {
		const withoutData = sendFlow({
			flowAction: 'navigate',
			flowScreen: 'WELCOME',
			flowScreenData: '{}',
		});
		await withoutData.run;
		const withObject = sendFlow({
			flowAction: 'navigate',
			flowScreen: 'WELCOME',
			flowScreenData: { name: 'Priya' },
		});
		await withObject.run;

		const payload = (request: { body: unknown }) =>
			(request.body as { interactive: { action: { parameters: Record<string, unknown> } } })
				.interactive.action.parameters.flow_action_payload;
		expect(payload(withoutData.intercepted.requests[0])).toEqual({ screen: 'WELCOME' });
		expect(payload(withObject.intercepted.requests[0])).toEqual({
			screen: 'WELCOME',
			data: { name: 'Priya' },
		});
	});

	it('by name: sends flow_name instead of flow_id', async () => {
		const { intercepted, run } = sendFlow({
			flow: { __rl: true, mode: 'name', value: 'appointment_booking' },
			additionalFields: { flowDraftMode: false },
		});
		await run;

		expect(intercepted.requests[0].body).toMatchObject({
			interactive: {
				action: {
					parameters: {
						flow_message_version: '3',
						flow_name: 'appointment_booking',
						flow_cta: 'Book now',
						flow_action: 'data_exchange',
					},
				},
			},
		});
		const parameters = (
			intercepted.requests[0].body as {
				interactive: { action: { parameters: Record<string, unknown> } };
			}
		).interactive.action.parameters;
		expect(parameters).not.toHaveProperty('flow_id');
		expect(parameters).not.toHaveProperty('mode');
	});

	it.each([
		// n8n rejects an empty required field itself; an expression that resolves to empty reaches the node.
		['no Flow', { flow: { __rl: true, mode: 'id', value: '={{ "" }}' } }, "'Flow' is empty"],
		['no button text', { flowButtonText: '={{ " " }}' }, "'Flow Button Text' is empty"],
		[
			'navigate with no screen',
			{ flowAction: 'navigate', flowScreen: '={{ "" }}' },
			"'Screen' is empty",
		],
		[
			'screen data that is not JSON',
			{ flowAction: 'navigate', flowScreen: 'WELCOME', flowScreenData: '{name: Priya' },
			"'Screen Data (JSON)' isn't valid JSON",
		],
		[
			'screen data that is not an object',
			{ flowAction: 'navigate', flowScreen: 'WELCOME', flowScreenData: '["Priya"]' },
			"'Screen Data (JSON)' must be an object",
		],
	])('%s: fails the item and makes no API call', async (_name, parameters, message) => {
		const { intercepted, run } = sendFlow(parameters);
		const { error } = await run;

		expect(error?.message).toContain(message);
		expect(error?.message).toContain('[item 0]');
		expect(intercepted.requests).toHaveLength(0);
	});

	it.each([1.1, 1.2])('v%s: a saved buttons message is sent exactly as before', async (version) => {
		const intercepted = interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());

		const { error } = await runWhatsApp({
			typeVersion: version,
			parameters: {
				messageType: 'interactive',
				interactiveType: 'button',
				interactiveBody: 'Continue?',
				interactiveButtons: { buttons: [{ id: 'yes', title: 'Yes' }] },
				additionalFields: {},
			},
		});

		expect(error).toBeUndefined();
		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'button',
				body: { text: 'Continue?' },
				action: { buttons: [{ type: 'reply', reply: { id: 'yes', title: 'Yes' } }] },
			},
		});
	});
});
