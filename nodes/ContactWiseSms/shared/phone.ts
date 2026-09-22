export type NormalizedPhone = { ok: true; value: string } | { ok: false };

/**
 * Converts the common ways Indian mobile numbers are written into the E.164 form the
 * ContactWise API expects (+91 followed by 10 digits).
 */
// Indian mobile numbers are 10 digits starting with 6, 7, 8 or 9.
const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const SEPARATORS = /[\s\-.()]/g;

export function normalizeIndianMobile(input: string): NormalizedPhone {
	const compact = input.replace(SEPARATORS, '');
	let national = compact;
	if (compact.startsWith('+91')) national = compact.slice(3);
	else if (compact.length === 12 && compact.startsWith('91')) national = compact.slice(2);
	else if (compact.length === 11 && compact.startsWith('0')) national = compact.slice(1);

	return INDIAN_MOBILE.test(national) ? { ok: true, value: `+91${national}` } : { ok: false };
}
