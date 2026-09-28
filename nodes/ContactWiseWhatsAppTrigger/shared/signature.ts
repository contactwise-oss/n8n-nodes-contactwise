import { createHmac, timingSafeEqual } from 'crypto';

/** Deliveries older (or further in the future) than this are rejected as replays. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

type HeaderValue = string | string[] | undefined;

function single(value: HeaderValue): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/**
 * Checks a ContactWise delivery's `X-CW-Signature-256` header. Starts from the function in the
 * TIN-34 integration contract, which was run against a real captured delivery.
 *
 * `rawBody` must be the request body exactly as received. Parsing and re-serialising it changes
 * the bytes whenever the message holds an emoji: ContactWise writes characters outside the BMP
 * as an escaped surrogate pair, and `JSON.stringify` writes them as literal UTF-8.
 */
export function verifyDelivery(
	/** The whole `whsec_…` string, prefix included: it's the HMAC key as is. */
	secret: string,
	rawBody: Buffer,
	/** Request headers with lowercased names, as Node.js gives them. */
	headers: Record<string, HeaderValue>,
	nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
	const timestamp = single(headers['x-cw-timestamp']);
	const header = single(headers['x-cw-signature-256']);
	if (!secret || !timestamp || !header) return false;

	// Unix seconds. Anything else (milliseconds, decimals, junk) falls outside the window or fails here.
	if (!/^\d{1,12}$/.test(timestamp)) return false;
	if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

	const expected = Buffer.from(
		'sha256=' +
			createHmac('sha256', secret)
				.update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]))
				.digest('hex'),
		'utf8',
	);

	// During secret rotation the header carries "sha256=<new>,sha256=<old>". Either one verifying
	// is a valid delivery.
	return header.split(',').some((part) => {
		const candidate = Buffer.from(part.trim(), 'utf8');
		return candidate.length === expected.length && timingSafeEqual(candidate, expected);
	});
}
