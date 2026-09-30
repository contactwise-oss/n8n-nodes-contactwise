import type { INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { TEST_API_KEY, TEST_TENANT_ID } from '../fixtures/contactwise-api';
import {
	type GatewayScenario,
	TEST_PHONE_NUMBER_ID,
	gatewayPath,
	interceptGateway,
	interceptMediaDownload,
	mediaDownloadPath,
	whatsAppScenarios,
} from '../fixtures/whatsapp-api';
import { runWhatsApp } from './whatsapp-node';

// Seam L2. From docs/contactwise-whatsapp-api.md: POST /{phone-number-id}/media (multipart:
// messaging_product, type, file) returns { id }; DELETE /{media-id} returns { success: true };
// GET /v1/whatsapp/{tenantId}/media/{mediaId}/content streams the file (TIN-33).
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

const phoneNumber = { __rl: true, mode: 'id', value: TEST_PHONE_NUMBER_ID };
const deleteParameters = {
	resource: 'media',
	operation: 'delete',
	phoneNumberId: phoneNumber,
	mediaId: '1000000000000004',
};

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
	it("deletes the media ID for the 'Phone Number' and outputs the result", async () => {
		const { requests } = interceptGateway(
			'delete',
			'1000000000000004',
			whatsAppScenarios.mediaDeleted(),
		);

		const { error, items } = await runWhatsApp({ base: deleteParameters });

		expect(error).toBeUndefined();
		expect(requests).toHaveLength(1);
		expect(requests[0].path).toBe(
			`${gatewayPath('1000000000000004')}?phone_number_id=${TEST_PHONE_NUMBER_ID}`,
		);
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

const MEDIA_ID = '1000000000000004';
const pdfBytes = Buffer.from('%PDF-1.7 downloaded');
const downloadParameters = {
	resource: 'media',
	operation: 'download',
	phoneNumberId: phoneNumber,
	mediaId: MEDIA_ID,
};
const downloadedPdf = () =>
	whatsAppScenarios.mediaFile(pdfBytes, {
		contentType: 'application/pdf',
		fileName: `${MEDIA_ID}.pdf`,
		sha256: 'abc123',
	});

describe('ContactWise WhatsApp: Media → Download', () => {
	it('downloads the file into the binary field and describes it in the JSON', async () => {
		const { requests } = interceptMediaDownload(MEDIA_ID, downloadedPdf());

		const { error, items } = await runWhatsApp({ base: downloadParameters });

		expect(error).toBeUndefined();
		expect(requests).toHaveLength(1);
		expect(requests[0].path).toBe(
			`${mediaDownloadPath(MEDIA_ID, TEST_TENANT_ID)}?phone_number_id=${TEST_PHONE_NUMBER_ID}`,
		);
		expect(requests[0].headers['x-cw-api-key']).toBe(TEST_API_KEY);
		expect(requests[0].headers['x-cw-source']).toMatch(/^n8n-nodes-contactwise\//);
		expect(items[0].json).toEqual({
			id: MEDIA_ID,
			mimeType: 'application/pdf',
			fileName: `${MEDIA_ID}.pdf`,
			fileSize: pdfBytes.length,
			sha256: 'abc123',
		});
		expect(items[0].binary?.data).toMatchObject({
			mimeType: 'application/pdf',
			fileName: `${MEDIA_ID}.pdf`,
		});
		expect(Buffer.from(items[0].binary!.data.data, 'base64')).toEqual(pdfBytes);
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});

	it("uses 'Put Output File in Field' and the 'File Name' option", async () => {
		interceptMediaDownload(MEDIA_ID, downloadedPdf());

		const { error, items } = await runWhatsApp({
			base: downloadParameters,
			parameters: { binaryPropertyName: 'invoice', options: { fileName: 'invoice.pdf' } },
		});

		expect(error).toBeUndefined();
		expect(items[0].binary?.data).toBeUndefined();
		expect(items[0].binary?.invoice).toMatchObject({ fileName: 'invoice.pdf' });
		expect(items[0].json.fileName).toBe('invoice.pdf');
	});

	it('keeps only the media type from a Content-Type with parameters', async () => {
		interceptMediaDownload(
			MEDIA_ID,
			whatsAppScenarios.mediaFile(Buffer.from('OggS'), {
				contentType: 'audio/ogg; codecs=opus',
				fileName: `${MEDIA_ID}.ogg`,
			}),
		);

		const { items } = await runWhatsApp({ base: downloadParameters });

		expect(items[0].json.mimeType).toBe('audio/ogg');
		expect(items[0].binary?.data.mimeType).toBe('audio/ogg');
	});

	it('404: says the media file was not found and what to check', async () => {
		interceptMediaDownload(MEDIA_ID, whatsAppScenarios.gatewayError(404, 'Media not found.'));

		const { error } = await runWhatsApp({ base: downloadParameters });

		expect(error?.message).toBe("The media file wasn't found [item 0]");
		expect(error?.description).toContain("'Media ID'");
		expect(`${error?.message} ${error?.description}`).not.toMatch(/sent/);
	});

	it('404 without a JSON body is still "not found"', async () => {
		interceptMediaDownload(MEDIA_ID, { status: 404, body: '' });

		const { error } = await runWhatsApp({ base: downloadParameters });

		expect(error?.message).toBe("The media file wasn't found [item 0]");
	});

	it('401 for a bad key or unknown tenant points at the credential', async () => {
		interceptMediaDownload(MEDIA_ID, whatsAppScenarios.gatewayError(401, 'Invalid API key.'));

		const { error } = await runWhatsApp({ base: downloadParameters });

		expect(error?.message).toBe(
			"The 'API Key' is invalid, or it doesn't belong to this tenant [item 0]",
		);
	});

	it('400 shows the gateway message', async () => {
		interceptMediaDownload(MEDIA_ID, whatsAppScenarios.gatewayError(400, 'Invalid media ID.'));

		const { error } = await runWhatsApp({ base: downloadParameters });

		expect(error?.message).toBe(
			'ContactWise rejected the download request: Invalid media ID. [item 0]',
		);
		expect(error?.description).toBe(
			"Nothing was downloaded. Check the 'Media ID', then try again.",
		);
	});

	it('a Meta rejection names the download request', async () => {
		interceptMediaDownload(
			MEDIA_ID,
			whatsAppScenarios.metaError(100, 'Invalid parameter', { details: 'Bad media ID' }),
		);

		const { error } = await runWhatsApp({ base: downloadParameters });

		expect(error?.message).toBe(
			'WhatsApp rejected the download request: Invalid parameter [item 0]',
		);
		expect(error?.description).toContain('Bad media ID.');
	});

	it('504: downloading has no side effects, so it tries again', async () => {
		const first = interceptMediaDownload(
			MEDIA_ID,
			whatsAppScenarios.gatewayError(504, 'Meta timed out.'),
		);
		const second = interceptMediaDownload(MEDIA_ID, downloadedPdf());

		const { error, items } = await runWhatsApp({ base: downloadParameters });

		expect(error).toBeUndefined();
		expect(first.requests).toHaveLength(1);
		expect(second.requests).toHaveLength(1);
		expect(items[0].json.id).toBe(MEDIA_ID);
	}, 10_000);

	it('a broken connection is retried too', async () => {
		interceptMediaDownload(MEDIA_ID, whatsAppScenarios.networkTimeout());
		interceptMediaDownload(MEDIA_ID, downloadedPdf());

		const { error, items } = await runWhatsApp({ base: downloadParameters });

		expect(error).toBeUndefined();
		expect(items[0].json.id).toBe(MEDIA_ID);
	}, 10_000);

	it('502 on every attempt: gives up after 3 with a download message', async () => {
		const attempts = [1, 2, 3, 4].map(() =>
			interceptMediaDownload(MEDIA_ID, whatsAppScenarios.gatewayError(502, 'Bad gateway.')),
		);

		const { error } = await runWhatsApp({ base: downloadParameters });

		expect(attempts.filter(({ requests }) => requests.length > 0)).toHaveLength(3);
		expect(error?.message).toBe(
			"The media file wasn't downloaded: the connection to ContactWise failed [item 0]",
		);
		expect(`${error?.message} ${error?.description}`).not.toMatch(/may already|sent/);
	}, 10_000);

	it('500: not retried', async () => {
		const first = interceptMediaDownload(
			MEDIA_ID,
			whatsAppScenarios.gatewayError(500, 'Unexpected error.'),
		);
		const second = interceptMediaDownload(MEDIA_ID, downloadedPdf());

		const { error } = await runWhatsApp({ base: downloadParameters });

		expect(first.requests).toHaveLength(1);
		expect(second.requests).toHaveLength(0);
		expect(error?.message).toBe(
			"The media file wasn't downloaded: ContactWise returned an unexpected response [item 0]",
		);
	});

	it('Continue On Fail keeps going with the next item', async () => {
		interceptMediaDownload(MEDIA_ID, whatsAppScenarios.gatewayError(404, 'Media not found.'));
		interceptMediaDownload(MEDIA_ID, downloadedPdf());

		const { items } = await runWhatsApp({
			base: downloadParameters,
			input: [{}, {}],
			continueOnFail: true,
		});

		expect(items[0].json).toMatchObject({ errorDetails: { httpStatus: 404 } });
		expect(items[0].binary).toBeUndefined();
		expect(items[1].json.id).toBe(MEDIA_ID);
		expect(items[1].binary?.data).toBeDefined();
	});
});

// TIN-68: 'Phone Number' on Delete and Download. Required from v1.4; optional before, so saved
// workflows keep working until the gateway requires phone_number_id (TIN-58).
const noPhoneNumber = { phoneNumberId: { __rl: true, mode: 'list', value: '' } };

describe.each([
	{
		operation: 'Delete',
		base: deleteParameters,
		intercept: (scenario: GatewayScenario) => interceptGateway('delete', MEDIA_ID, scenario),
		ok: () => whatsAppScenarios.mediaDeleted(),
		path: gatewayPath(MEDIA_ID),
	},
	{
		operation: 'Download',
		base: downloadParameters,
		intercept: (scenario: GatewayScenario) => interceptMediaDownload(MEDIA_ID, scenario),
		ok: downloadedPdf,
		path: mediaDownloadPath(MEDIA_ID),
	},
])('ContactWise WhatsApp: Media → $operation, Phone Number', ({ base, intercept, ok, path }) => {
	it.each([1, 1.3])('v%s without a phone number: sends no phone_number_id', async (typeVersion) => {
		const { requests } = intercept(ok());

		const { error } = await runWhatsApp({ base, parameters: noPhoneNumber, typeVersion });

		expect(error).toBeUndefined();
		expect(requests[0].path).toBe(path);
	});

	it('v1.3 with a phone number: sends it', async () => {
		const { requests } = intercept(ok());

		const { error } = await runWhatsApp({ base, typeVersion: 1.3 });

		expect(error).toBeUndefined();
		expect(requests[0].path).toBe(`${path}?phone_number_id=${TEST_PHONE_NUMBER_ID}`);
	});

	it("v1.4: 'Phone Number' is required", async () => {
		const { requests } = intercept(ok());

		await expect(runWhatsApp({ base, parameters: noPhoneNumber })).rejects.toThrow(/has issues/);
		expect(requests).toHaveLength(0);
	});

	it('v1.4 with a phone number that resolves to nothing: fails before any API call', async () => {
		const { requests } = intercept(ok());

		const { error } = await runWhatsApp({
			base,
			parameters: { phoneNumberId: { __rl: true, mode: 'id', value: '={{ "" }}' } },
		});

		expect(error?.message).toBe("'Phone Number' is empty [item 0]");
		expect(error?.description).toContain('received');
		expect(requests).toHaveLength(0);
	});

	it("Meta's (#10) Permission denied points at 'Phone Number'", async () => {
		intercept(whatsAppScenarios.metaError(10, 'Permission denied'));

		const { error } = await runWhatsApp({ base });

		expect(error?.message).toMatch(/Permission denied \[item 0\]$/);
		expect(error?.description).toContain("'Phone Number'");
	});
});
