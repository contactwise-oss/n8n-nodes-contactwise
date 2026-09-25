import type { IDataObject } from 'n8n-workflow';
import { WAIT_INDEFINITELY } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	TEST_PHONE_NUMBER_ID,
	interceptGateway,
	whatsAppScenarios,
} from '../fixtures/whatsapp-api';
import { runWhatsApp } from './whatsapp-node';

// Seam L2. The outgoing message is a WhatsApp text (docs/contactwise-whatsapp-api.md); the links
// are n8n's signed resume URLs for this execution and node (harness: http://localhost/waiting-webhook).
const messagesPath = `${TEST_PHONE_NUMBER_ID}/messages`;
const RESUME_URL =
	/http:\/\/localhost\/waiting-webhook\/test-execution\/node-under-test\?[^\s]*signature=[^\s]+/;

const baseWaitParameters = {
	resource: 'message',
	operation: 'sendAndWait',
	phoneNumberId: { __rl: true, mode: 'id', value: TEST_PHONE_NUMBER_ID },
	recipientPhoneNumber: '+44 7700 900123',
	message: 'Approve order #42 & ship it?',
	responseType: 'approval',
	approvalOptions: { values: { approvalType: 'single', approveLabel: 'Approve' } },
	options: {},
};

function sendAndWait(parameters: IDataObject = {}, input?: IDataObject[]) {
	return runWhatsApp({ base: baseWaitParameters, parameters, input });
}

function textOf(body: unknown): string {
	return (body as { text: { body: string } }).text.body;
}

describe('ContactWise WhatsApp: Message → Send and Wait for Response', () => {
	it('approval: sends one text with the message and a signed approve link, then waits indefinitely', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		const { error, items, run } = await sendAndWait({}, [{ order: 42 }, { order: 43 }]);

		expect(error).toBeUndefined();
		// FR-W1: one message per execution, whatever the number of input items.
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toMatchObject({ type: 'text', to: '447700900123' });
		const text = textOf(requests[0].body);
		// Not HTML-escaped (the official node sends `&amp;`).
		expect(text.startsWith('Approve order #42 & ship it?\n\n*Approve:*\n')).toBe(true);
		expect(text).toMatch(RESUME_URL);
		expect(text).toContain('approved=true');
		expect(text).not.toContain('&amp;');
		expect(run.waitTill).toEqual(WAIT_INDEFINITELY);
		expect(items.map((item) => item.json)).toEqual([{ order: 42 }, { order: 43 }]);
	});

	it('double approval: a decline link, then an approve link, each with its own label', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		await sendAndWait({
			approvalOptions: {
				values: { approvalType: 'double', approveLabel: 'Ship it', disapproveLabel: 'Hold' },
			},
			options: { appendAttribution: false },
		});

		const text = textOf(requests[0].body);
		expect(text).toMatch(/\*Hold:\*\n\S*approved=false\S*\n\n\*Ship it:\*\n\S*approved=true\S*$/);
		expect(text).not.toContain('n8n.io');
	});

	it('attribution is on by default', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		await sendAndWait();

		expect(textOf(requests[0].body)).toMatch(/This message was sent automatically with n8n/);
	});

	it('Limit Wait Time after an interval: waits until now + the interval', async () => {
		interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());
		const before = Date.now();

		const { run } = await sendAndWait({
			options: {
				limitWaitTime: {
					values: { limitType: 'afterTimeInterval', resumeAmount: 2, resumeUnit: 'hours' },
				},
			},
		});

		const waitMs = (run.waitTill as Date).getTime() - before;
		expect(waitMs).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
		expect(waitMs).toBeLessThan(2 * 60 * 60 * 1000 + 60_000);
	});

	it('Limit Wait Time at a specified time: waits until that time', async () => {
		interceptGateway('post', messagesPath, whatsAppScenarios.messageAccepted());

		const { run } = await sendAndWait({
			options: {
				limitWaitTime: {
					values: { limitType: 'atSpecifiedTime', maxDateAndTime: '2026-12-31T18:00:00.000Z' },
				},
			},
		});

		expect(run.waitTill).toEqual(new Date('2026-12-31T18:00:00.000Z'));
	});

	it('a failed send stops with the WhatsApp reason and never starts waiting', async () => {
		interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.metaError(131026, 'Message undeliverable'),
		);

		const { error, run } = await sendAndWait();

		expect(error?.message).toBe('WhatsApp rejected the message: Message undeliverable [item 0]');
		expect(run.waitTill).toBeUndefined();
	});

	it.each(['freeText', 'customForm'])(
		'%s: sends one signed link under the respond label',
		async (responseType) => {
			const { requests } = interceptGateway(
				'post',
				messagesPath,
				whatsAppScenarios.messageAccepted(),
			);

			await sendAndWait({
				responseType,
				formFields: { values: [{ fieldLabel: 'Quantity', fieldType: 'number' }] },
				options: { messageButtonLabel: 'Reply here', appendAttribution: false },
			});

			const text = textOf(requests[0].body);
			expect(text).toMatch(
				/^Approve order #42 & ship it\?\n\n\*Reply here:\*\nhttp:\/\/localhost\/waiting-webhook\/\S+$/,
			);
			expect(text).not.toContain('approved=');
		},
	);

	it('custom form with no fields: fails before sending, so the recipient never gets an empty form', async () => {
		const { requests } = interceptGateway(
			'post',
			messagesPath,
			whatsAppScenarios.messageAccepted(),
		);

		const { error, run } = await sendAndWait({ responseType: 'customForm', formFields: {} });

		expect(error?.message).toContain("'Form Fields'");
		expect(requests).toHaveLength(0);
		expect(run.waitTill).toBeUndefined();
	});
});
