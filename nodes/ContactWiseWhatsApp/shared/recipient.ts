export type NormalizedRecipient = { ok: true; value: string } | { ok: false };

/**
 * Converts a recipient's international number into the form Meta expects: digits only, no `+`.
 * Any country is allowed; the number must have 8–15 digits (E.164 allows at most 15).
 */
const SEPARATORS = /[\s\-.()+]/g;
const INTERNATIONAL_DIGITS = /^\d{8,15}$/;

export function normalizeRecipientPhoneNumber(input: string): NormalizedRecipient {
	const digits = input.replace(SEPARATORS, '');
	return INTERNATIONAL_DIGITS.test(digits) ? { ok: true, value: digits } : { ok: false };
}
