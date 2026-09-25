import type { INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	TEST_PHONE_NUMBER_ID,
	interceptGateway,
	whatsAppScenarios,
} from '../fixtures/whatsapp-api';
import { runWhatsApp } from './whatsapp-node';

// Seam L2. From docs/contactwise-whatsapp-api.md: POST /{phone-number-id}/media (multipart:
// messaging_product, type, file) returns { id }; DELETE /{media-id} returns { success: true }.
const pdf: INodeExecutionData = {
	json: {},
	binary: {
		data: {
			data: Buffer.from('%PDF-fake').toString('base64'),
			mimeType: 'application/pdf',
			fileName: 'invoice.pdf',
		},
	},
};

const uploadParameters = {
	resource: 'media',
	operation: 'upload',
	phoneNumberId: { __rl: true, mode: 'id', value: TEST_PHONE_NUMBER_ID },
	binaryPropertyName: 'data',
};

const deleteParameters = { resource: 'media', operation: 'delete', mediaId: '1000000000000004' };

describe('ContactWise WhatsApp: Media → Upload', () => {
	it("uploads the item's file as multipart and outputs the media ID", async () => {
		const { requests } = interceptGateway(
			'post',
			`${TEST_PHONE_NUMBER_ID}/media`,
			whatsAppScenarios.mediaUploaded('777'),
		);

		const { error, items } = await runWhatsApp({ base: uploadParameters, inputItems: [pdf] });

		expect(error).toBeUndefined();
		const multipart = String(requests[0].body);
		expect(multipart).toMatch(/name="messaging_product"\r\n\r\nwhatsapp/);
		expect(multipart).toMatch(/name="type"\r\n\r\napplication\/pdf/);
		expect(multipart).toMatch(/name="file"; filename="invoice.pdf"/);
		expect(items[0].json).toEqual({ id: '777' });
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});

	it('an item without the binary field fails before any API call', async () => {
		const { requests } = interceptGateway(
			'post',
			`${TEST_PHONE_NUMBER_ID}/media`,
			whatsAppScenarios.mediaUploaded(),
		);

		const { error } = await runWhatsApp({ base: uploadParameters, inputItems: [{ json: {} }] });

		expect(error?.message).toMatch(/data/);
		expect(requests).toHaveLength(0);
	});

	it('a timeout says the file may already have been uploaded, never sent', async () => {
		interceptGateway('post', `${TEST_PHONE_NUMBER_ID}/media`, whatsAppScenarios.networkTimeout());

		const { error } = await runWhatsApp({ base: uploadParameters, inputItems: [pdf] });

		expect(error?.message).toBe(
			'The media file may already have been uploaded: the connection to ContactWise failed [item 0]',
		);
	});
});

describe('ContactWise WhatsApp: Media → Delete', () => {
	it('deletes the media ID and outputs the result', async () => {
		const { requests } = interceptGateway(
			'delete',
			'1000000000000004',
			whatsAppScenarios.mediaDeleted(),
		);

		const { error, items } = await runWhatsApp({ base: deleteParameters });

		expect(error).toBeUndefined();
		expect(requests).toHaveLength(1);
		expect(items[0].json).toEqual({ success: true });
	});

	it('a rejected delete names the delete request', async () => {
		interceptGateway(
			'delete',
			'1000000000000004',
			whatsAppScenarios.metaError(100, 'Unsupported delete request', {
				details: 'Object does not exist',
			}),
		);

		const { error } = await runWhatsApp({ base: deleteParameters });

		expect(error?.message).toBe(
			'WhatsApp rejected the delete request: Unsupported delete request [item 0]',
		);
		expect(error?.description).toContain('Nothing was deleted.');
	});

	it('Continue On Fail keeps going with the next item', async () => {
		interceptGateway(
			'delete',
			'1000000000000004',
			whatsAppScenarios.metaError(100, 'Unsupported delete request'),
		);
		interceptGateway('delete', '1000000000000004', whatsAppScenarios.mediaDeleted());

		const { items } = await runWhatsApp({
			base: deleteParameters,
			input: [{}, {}],
			continueOnFail: true,
		});

		expect(items[0].json).toMatchObject({ errorDetails: { outcome: 'not-sent', codes: [100] } });
		expect(items[1].json).toEqual({ success: true });
	});
});
