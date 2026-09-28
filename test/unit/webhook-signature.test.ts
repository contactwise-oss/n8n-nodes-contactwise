import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';

import {
	SIGNATURE_TOLERANCE_SECONDS,
	verifyDelivery,
} from '../../nodes/ContactWiseWhatsAppTrigger/shared/signature';

// Expected values come from the TIN-34 spec and the integration contract, not the implementation.
const NOW = 1_790_000_000;

function sign(secret: string, timestamp: number | string, rawBody: Buffer) {
	return (
		'sha256=' +
		createHmac('sha256', secret)
			.update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]))
			.digest('hex')
	);
}

function headersFor(signature: string, timestamp: number | string = NOW) {
	return { 'x-cw-signature-256': signature, 'x-cw-timestamp': String(timestamp) };
}

/**
 * A delivery body as ContactWise writes it: characters outside the BMP (the waving-hand emoji)
 * as an escaped surrogate pair, 12 ASCII characters. `JSON.stringify` writes them as 4 UTF-8 bytes.
 */
const EMOJI_BODY = Buffer.from(
	'{"object":"whatsapp_business_account","entry":[{"id":"100000000000001","changes":[{"field":"messages","value":{"messages":[{"from":"447700900123","type":"text","text":{"body":"Hi \\uD83D\\uDC4B नमस्ते"}}]}}]}]}',
	'utf8',
);

describe('verifyDelivery', () => {
	it('reproduces the spec test vector', () => {
		const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', 'utf8');
		const expected = 'sha256=4d061e812335c3afeac2dc33f8be8e2ee7a7f6e95a104a57fefc05b74edf8bb9';

		expect(sign('whsec_test', 1790000000, body)).toBe(expected);
		expect(verifyDelivery('whsec_test', body, headersFor(expected, 1790000000), NOW)).toBe(true);
	});

	it('uses the whole secret, whsec_ prefix included, as the HMAC key', () => {
		const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', 'utf8');
		const signedWithoutPrefix = sign('test', NOW, body);

		expect(verifyDelivery('whsec_test', body, headersFor(signedWithoutPrefix), NOW)).toBe(false);
	});

	it('verifies a body containing an emoji against the raw bytes', () => {
		const signature = sign('whsec_emoji', NOW, EMOJI_BODY);

		expect(verifyDelivery('whsec_emoji', EMOJI_BODY, headersFor(signature), NOW)).toBe(true);
	});

	it('fails for the same body parsed and re-serialised, so verification must use raw bytes', () => {
		const signature = sign('whsec_emoji', NOW, EMOJI_BODY);
		const reserialised = Buffer.from(JSON.stringify(JSON.parse(EMOJI_BODY.toString('utf8'))));

		expect(reserialised.length).toBe(EMOJI_BODY.length - 8);
		expect(verifyDelivery('whsec_emoji', reserialised, headersFor(signature), NOW)).toBe(false);
	});

	it('rejects a tampered body', () => {
		const signature = sign('whsec_x', NOW, EMOJI_BODY);
		const tampered = Buffer.from(
			EMOJI_BODY.toString('utf8').replace('447700900123', '447700900999'),
		);

		expect(verifyDelivery('whsec_x', tampered, headersFor(signature), NOW)).toBe(false);
	});

	it('rejects a signature made with another secret', () => {
		const signature = sign('whsec_other', NOW, EMOJI_BODY);

		expect(verifyDelivery('whsec_x', EMOJI_BODY, headersFor(signature), NOW)).toBe(false);
	});

	describe('secret rotation', () => {
		const header = `${sign('whsec_new', NOW, EMOJI_BODY)},${sign('whsec_old', NOW, EMOJI_BODY)}`;

		it('accepts a two-signature header with the new secret', () => {
			expect(verifyDelivery('whsec_new', EMOJI_BODY, headersFor(header), NOW)).toBe(true);
		});

		it('accepts a two-signature header with the old secret', () => {
			expect(verifyDelivery('whsec_old', EMOJI_BODY, headersFor(header), NOW)).toBe(true);
		});

		it('rejects a header signed only with the old secret once only the new one is held', () => {
			const oldOnly = sign('whsec_old', NOW, EMOJI_BODY);

			expect(verifyDelivery('whsec_new', EMOJI_BODY, headersFor(oldOnly), NOW)).toBe(false);
		});
	});

	describe('timestamp', () => {
		it(`accepts a delivery exactly ${SIGNATURE_TOLERANCE_SECONDS} seconds old`, () => {
			const timestamp = NOW - SIGNATURE_TOLERANCE_SECONDS;
			const signature = sign('whsec_x', timestamp, EMOJI_BODY);

			expect(verifyDelivery('whsec_x', EMOJI_BODY, headersFor(signature, timestamp), NOW)).toBe(
				true,
			);
		});

		it('rejects a delivery older than 5 minutes, even when correctly signed', () => {
			const timestamp = NOW - SIGNATURE_TOLERANCE_SECONDS - 1;
			const signature = sign('whsec_x', timestamp, EMOJI_BODY);

			expect(verifyDelivery('whsec_x', EMOJI_BODY, headersFor(signature, timestamp), NOW)).toBe(
				false,
			);
		});

		it('rejects a timestamp more than 5 minutes in the future', () => {
			const timestamp = NOW + SIGNATURE_TOLERANCE_SECONDS + 1;
			const signature = sign('whsec_x', timestamp, EMOJI_BODY);

			expect(verifyDelivery('whsec_x', EMOJI_BODY, headersFor(signature, timestamp), NOW)).toBe(
				false,
			);
		});

		it('rejects a timestamp in milliseconds', () => {
			const timestamp = NOW * 1000;
			const signature = sign('whsec_x', timestamp, EMOJI_BODY);

			expect(verifyDelivery('whsec_x', EMOJI_BODY, headersFor(signature, timestamp), NOW)).toBe(
				false,
			);
		});

		it.each(['', 'abc', '1790000000.5', '-1'])('rejects the timestamp %j', (timestamp) => {
			const signature = sign('whsec_x', timestamp, EMOJI_BODY);

			expect(verifyDelivery('whsec_x', EMOJI_BODY, headersFor(signature, timestamp), NOW)).toBe(
				false,
			);
		});
	});

	describe('missing or malformed headers', () => {
		const signature = sign('whsec_x', NOW, EMOJI_BODY);

		it('rejects a delivery without a signature', () => {
			expect(verifyDelivery('whsec_x', EMOJI_BODY, { 'x-cw-timestamp': String(NOW) }, NOW)).toBe(
				false,
			);
		});

		it('rejects a delivery without a timestamp', () => {
			expect(verifyDelivery('whsec_x', EMOJI_BODY, { 'x-cw-signature-256': signature }, NOW)).toBe(
				false,
			);
		});

		it('rejects repeated signature headers', () => {
			const headers = {
				'x-cw-signature-256': [signature, signature],
				'x-cw-timestamp': String(NOW),
			};

			expect(verifyDelivery('whsec_x', EMOJI_BODY, headers, NOW)).toBe(false);
		});

		it('rejects a bare hex digest without the sha256= prefix', () => {
			expect(
				verifyDelivery('whsec_x', EMOJI_BODY, headersFor(signature.slice('sha256='.length)), NOW),
			).toBe(false);
		});

		it('rejects an uppercase hex digest', () => {
			const upper = 'sha256=' + signature.slice('sha256='.length).toUpperCase();

			expect(verifyDelivery('whsec_x', EMOJI_BODY, headersFor(upper), NOW)).toBe(false);
		});

		it('rejects an empty secret', () => {
			expect(verifyDelivery('', EMOJI_BODY, headersFor(sign('', NOW, EMOJI_BODY)), NOW)).toBe(
				false,
			);
		});
	});
});
