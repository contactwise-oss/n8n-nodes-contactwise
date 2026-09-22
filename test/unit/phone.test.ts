import { describe, expect, it } from 'vitest';

import { normalizeIndianMobile } from '../../nodes/ContactWiseSms/shared/phone';

// Expected values come from TIN-9 and docs/contactwise-sms-api.md: the API receives E.164 (+91...).
describe('normalizeIndianMobile', () => {
	it('turns a bare 10-digit mobile number into E.164', () => {
		expect(normalizeIndianMobile('9876543210')).toEqual({ ok: true, value: '+919876543210' });
	});

	it.each([
		['09876543210', 'trunk prefix 0'],
		['919876543210', 'country code without plus'],
		['+919876543210', 'already E.164'],
		['+91 98765-43210', 'spaces and dashes'],
		['(+91) 98765 43210', 'bracketed country code'],
		['+91.98765.43210', 'dots'],
		['  9876543210  ', 'surrounding whitespace'],
	])('accepts %s (%s) as +919876543210', (input) => {
		expect(normalizeIndianMobile(input)).toEqual({ ok: true, value: '+919876543210' });
	});

	it('keeps a 10-digit number that starts with 91 intact', () => {
		expect(normalizeIndianMobile('9123456789')).toEqual({ ok: true, value: '+919123456789' });
	});

	it.each([
		['12345', 'too short'],
		['5876543210', 'starts with 5, not an Indian mobile range'],
		['98765abcde', 'contains letters'],
		['', 'empty'],
		['+14155238886', 'another country code'],
		['9198765432101', 'too long'],
		['0091 98765 43210', '00 international prefix'],
		['+91 22 1234 5678', 'landline'],
	])('rejects %s (%s)', (input) => {
		expect(normalizeIndianMobile(input)).toEqual({ ok: false });
	});
});
