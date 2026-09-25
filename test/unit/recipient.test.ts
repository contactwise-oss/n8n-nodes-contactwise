import { describe, expect, it } from 'vitest';

import { normalizeRecipientPhoneNumber } from '../../nodes/ContactWiseWhatsApp/shared/recipient';

// FR-W2 (epic TIN-30) and docs/contactwise-whatsapp-api.md: international number, digits only,
// 8–15 digits, no `+`. No country restriction.
describe('normalizeRecipientPhoneNumber', () => {
	it.each([
		['+44 7700 900123', '447700900123'],
		['+1 (415) 555-0100', '14155550100'],
		['(+91) 98765-43210', '919876543210'],
		['49.30.1234567', '49301234567'],
		['12345678', '12345678'],
		['123456789012345', '123456789012345'],
	])('%s → %s', (input, expected) => {
		expect(normalizeRecipientPhoneNumber(input)).toEqual({ ok: true, value: expected });
	});

	it.each([
		['7 digits', '1234567'],
		['16 digits', '1234567890123456'],
		['letters', '+44 77OO 900123'],
		['empty', ''],
	])('rejects %s', (_name, input) => {
		expect(normalizeRecipientPhoneNumber(input)).toEqual({ ok: false });
	});
});
