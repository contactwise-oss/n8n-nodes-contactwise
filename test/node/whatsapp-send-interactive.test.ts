import { describe, expect, it } from 'vitest';

import {
	TEST_PHONE_NUMBER_ID,
	interceptGateway,
	whatsAppScenarios,
} from '../fixtures/whatsapp-api';
import { baseSendParameters, runWhatsApp } from './whatsapp-node';

// Expected bodies come from the interactive section of docs/contactwise-whatsapp-api.md (TIN-61).
const messagesPath = `${TEST_PHONE_NUMBER_ID}/messages`;

const envelope = {
	messaging_product: 'whatsapp',
	recipient_type: 'individual',
	to: '447700900123',
	type: 'interactive',
};

const buttons = (...titles: string[]) => ({
	buttons: titles.map((title, index) => ({ id: `option-${index + 1}`, title })),
});

const rows = (count: number) => ({
	rows: Array.from({ length: count }, (_, index) => ({
		id: `row-${index + 1}`,
		title: `Row ${index + 1}`,
	})),
});

function sendInteractive(parameters: Record<string, unknown>) {
	const intercepted = interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());
	const run = runWhatsApp({
		parameters: { messageType: 'interactive', additionalFields: {}, ...parameters },
	});
	return { intercepted, run };
}

describe('ContactWise WhatsApp: Message → Send, interactive (v1.1 and later)', () => {
	it('buttons: sends reply buttons with a header and footer', async () => {
		const { intercepted, run } = sendInteractive({
			interactiveType: 'button',
			interactiveBody: 'What would you like to know?',
			interactiveButtons: {
				buttons: [
					{ id: 'timings', title: 'Show timings' },
					{ id: 'tickets', title: 'Tickets' },
					{ id: 'venue', title: 'Venue' },
				],
			},
			additionalFields: {
				interactiveHeader: 'Sunrise Bakery',
				interactiveFooter: 'Tap a button',
			},
		});
		const { items, error } = await run;

		expect(error).toBeUndefined();
		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'button',
				header: { type: 'text', text: 'Sunrise Bakery' },
				body: { text: 'What would you like to know?' },
				footer: { text: 'Tap a button' },
				action: {
					buttons: [
						{ type: 'reply', reply: { id: 'timings', title: 'Show timings' } },
						{ type: 'reply', reply: { id: 'tickets', title: 'Tickets' } },
						{ type: 'reply', reply: { id: 'venue', title: 'Venue' } },
					],
				},
			},
		});
		expect(items[0].json.messages).toEqual([{ id: 'wamid.HBgLNDQ3NzAwOTAwMTIzFQIAERgSMA==' }]);
	});

	it('buttons: leaves out the header and footer when they are empty', async () => {
		const { intercepted, run } = sendInteractive({
			interactiveType: 'button',
			interactiveBody: 'Continue?',
			interactiveButtons: buttons('Yes'),
		});
		await run;

		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'button',
				body: { text: 'Continue?' },
				action: { buttons: [{ type: 'reply', reply: { id: 'option-1', title: 'Yes' } }] },
			},
		});
	});

	it('list: sends one section with its title, rows with descriptions, header and footer', async () => {
		const { intercepted, run } = sendInteractive({
			interactiveType: 'list',
			interactiveBody: 'Pick an option',
			listButtonText: 'Menu',
			listRows: {
				rows: [
					{ id: 'timings', title: 'Show timings', description: 'Friday to Sunday' },
					{ id: 'agent', title: 'Talk to a person', description: '' },
				],
			},
			additionalFields: {
				interactiveHeader: 'Sunrise Bakery',
				interactiveFooter: 'We answer 10 am to 8 pm',
				listSectionTitle: 'Shows',
			},
		});
		const { error } = await run;

		expect(error).toBeUndefined();
		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'list',
				header: { type: 'text', text: 'Sunrise Bakery' },
				body: { text: 'Pick an option' },
				footer: { text: 'We answer 10 am to 8 pm' },
				action: {
					button: 'Menu',
					sections: [
						{
							title: 'Shows',
							rows: [
								{ id: 'timings', title: 'Show timings', description: 'Friday to Sunday' },
								{ id: 'agent', title: 'Talk to a person' },
							],
						},
					],
				},
			},
		});
	});

	it('list: sends a section without a title when none is set', async () => {
		const { intercepted, run } = sendInteractive({
			interactiveType: 'list',
			interactiveBody: 'Pick one',
			listButtonText: 'Options',
			listRows: rows(1),
		});
		await run;

		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'list',
				body: { text: 'Pick one' },
				action: { button: 'Options', sections: [{ rows: [{ id: 'row-1', title: 'Row 1' }] }] },
			},
		});
	});

	it.each([
		['no buttons', { interactiveType: 'button', interactiveButtons: {} }, "'Buttons'"],
		[
			'4 buttons',
			{ interactiveType: 'button', interactiveButtons: buttons('A', 'B', 'C', 'D') },
			"'Buttons'",
		],
		['no rows', { interactiveType: 'list', listButtonText: 'Menu', listRows: {} }, "'Rows'"],
		['11 rows', { interactiveType: 'list', listButtonText: 'Menu', listRows: rows(11) }, "'Rows'"],
	])('%s: fails the item and makes no API call', async (_name, parameters, field) => {
		const { intercepted, run } = sendInteractive({ interactiveBody: 'Hi', ...parameters });
		const { error } = await run;

		expect(error?.message).toContain(field);
		expect(error?.message).toContain('[item 0]');
		expect(intercepted.requests).toHaveLength(0);
	});

	it('v1.2: buttons as a JSON array send the same body as the fields', async () => {
		const { intercepted, run } = sendInteractive({
			interactiveType: 'button',
			interactiveBody: 'Which department?',
			buttonsInputMode: 'json',
			buttonsJson: [
				{ id: 'cardiology', title: 'Cardiology' },
				{ id: 'ortho', title: 'Orthopaedics' },
			],
		});
		const { error } = await run;

		expect(error).toBeUndefined();
		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'button',
				body: { text: 'Which department?' },
				action: {
					buttons: [
						{ type: 'reply', reply: { id: 'cardiology', title: 'Cardiology' } },
						{ type: 'reply', reply: { id: 'ortho', title: 'Orthopaedics' } },
					],
				},
			},
		});
	});

	it('v1.2: list rows as a JSON string send the same body as the fields', async () => {
		const { intercepted, run } = sendInteractive({
			interactiveType: 'list',
			interactiveBody: 'Pick a doctor',
			listButtonText: 'Doctors',
			rowsInputMode: 'json',
			rowsJson:
				'[{"id":"dr-meenakshi","title":"Dr. Meenakshi","description":"Cardiology, Mon Wed Fri"},{"id":"dr-arvind","title":"Dr. Arvind"}]',
		});
		const { error } = await run;

		expect(error).toBeUndefined();
		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'list',
				body: { text: 'Pick a doctor' },
				action: {
					button: 'Doctors',
					sections: [
						{
							rows: [
								{
									id: 'dr-meenakshi',
									title: 'Dr. Meenakshi',
									description: 'Cardiology, Mon Wed Fri',
								},
								{ id: 'dr-arvind', title: 'Dr. Arvind' },
							],
						},
					],
				},
			},
		});
	});

	const jsonButtons = (buttonsJson: unknown) => ({
		interactiveType: 'button',
		buttonsInputMode: 'json',
		buttonsJson,
	});
	const jsonRows = (rowsJson: unknown) => ({
		interactiveType: 'list',
		listButtonText: 'Menu',
		rowsInputMode: 'json',
		rowsJson,
	});

	it.each([
		['buttons that are not JSON', jsonButtons('[{id: yes}'), "'Buttons (JSON)' isn't valid JSON"],
		[
			'buttons that are not an array',
			jsonButtons({ id: 'yes', title: 'Yes' }),
			"'Buttons (JSON)' must be an array",
		],
		['a button without a title', jsonButtons([{ id: 'yes' }]), "'Buttons (JSON)' entry 1 needs"],
		[
			'a row with a number ID',
			jsonRows([
				{ id: 'a', title: 'A' },
				{ id: 2, title: 'B' },
			]),
			"'Rows (JSON)' entry 2 needs",
		],
		['4 buttons', jsonButtons(buttons('A', 'B', 'C', 'D').buttons), "'Buttons'"],
		['no rows', jsonRows('[]'), "'Rows'"],
	])('v1.2: %s fails the item and makes no API call', async (_name, parameters, message) => {
		const { intercepted, run } = sendInteractive({ interactiveBody: 'Hi', ...parameters });
		const { error } = await run;

		expect(error?.message).toContain(message);
		expect(error?.message).toContain('[item 0]');
		expect(intercepted.requests).toHaveLength(0);
	});

	it('v1.1: a saved buttons message is sent exactly as before', async () => {
		const intercepted = interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());

		const { error } = await runWhatsApp({
			typeVersion: 1.1,
			parameters: {
				messageType: 'interactive',
				interactiveType: 'button',
				interactiveBody: 'Continue?',
				interactiveButtons: buttons('Yes'),
				additionalFields: {},
			},
		});

		expect(error).toBeUndefined();
		expect(intercepted.requests[0].body).toEqual({
			...envelope,
			interactive: {
				type: 'button',
				body: { text: 'Continue?' },
				action: { buttons: [{ type: 'reply', reply: { id: 'option-1', title: 'Yes' } }] },
			},
		});
	});

	it('v1: a text message is sent exactly as before', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		const { error } = await runWhatsApp({ typeVersion: 1, parameters: baseSendParameters });

		expect(error).toBeUndefined();
		expect(requests[0].body).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '447700900123',
			type: 'text',
			text: { body: 'Hello from n8n', preview_url: false },
		});
	});
});
