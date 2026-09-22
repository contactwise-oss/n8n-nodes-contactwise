import { describe, expect, it } from 'vitest';

import { interpretFailure } from '../../nodes/ContactWiseSms/shared/errors';

// One case per row of the error table in docs/contactwise-sms-api.md.
describe('interpretFailure', () => {
	it('400 errors[]: not sent, lists every message and code, points at the fields to fix', () => {
		const failure = interpretFailure({
			statusCode: 400,
			body: {
				errors: [
					{ field: 'from', code: 9002, message: 'Sender ID is not registered' },
					{ field: 'body', code: 9008, message: 'Message body does not match the template' },
				],
			},
		});

		expect(failure).toMatchObject({
			outcome: 'not-sent',
			retryable: false,
			httpStatus: 400,
			codes: [9002, 9008],
			messages: ['Sender ID is not registered', 'Message body does not match the template'],
		});
		expect(failure.message).toContain('Sender ID is not registered');
		expect(failure.message).toContain('Message body does not match the template');
		expect(failure.description).toContain("'Sender ID'");
		expect(failure.description).toContain("'Message'");
	});

	it('400 problem+json: not sent, flattens the field errors into readable text', () => {
		const failure = interpretFailure({
			statusCode: 400,
			body: {
				title: 'One or more validation errors occurred.',
				status: 400,
				errors: { $: ['The JSON value could not be converted.'], to: ['Required'] },
				traceId: '00-pd-00',
			},
		});

		expect(failure).toMatchObject({
			outcome: 'not-sent',
			retryable: false,
			httpStatus: 400,
			traceId: '00-pd-00',
		});
		// Raw API field keys never reach the user: known fields get their display names.
		expect(failure.messages).toEqual([
			'the request: The JSON value could not be converted.',
			"'To': Required",
		]);
		expect(failure.message).toContain("'To': Required");
	});

	it('400 errors[] with an undocumented code adds general guidance alongside the specific fix', () => {
		const failure = interpretFailure({
			statusCode: 400,
			body: {
				errors: [
					{ field: 'from', code: 9002, message: 'Sender ID is not registered' },
					{ field: null, code: 9999, message: 'Something new' },
				],
			},
		});

		expect(failure.description).toContain("'Sender ID'");
		expect(failure.description).toContain('Check the values listed above');
	});

	it.each([403, 404, 422])(
		'%i (not in the table): not sent, not retried, names the status',
		(statusCode) => {
			const failure = interpretFailure({ statusCode, body: '' });

			expect(failure).toMatchObject({
				outcome: 'not-sent',
				retryable: false,
				httpStatus: statusCode,
			});
			expect(failure.message).toContain(String(statusCode));
		},
	);

	it('401: not sent, tells the user to check the credential', () => {
		const failure = interpretFailure({ statusCode: 401, body: '' });

		expect(failure).toMatchObject({ outcome: 'not-sent', retryable: false, httpStatus: 401 });
		expect(failure.message).toBe("The 'API Key' is invalid, or it doesn't belong to this tenant");
		expect(failure.description).toContain("'Tenant ID'");
	});

	it.each([
		[429, 9010, '3', 3],
		[503, 9011, '7', 7],
	])(
		'%i: not sent and retryable, with code %s and Retry-After %s',
		(statusCode, code, header, seconds) => {
			const failure = interpretFailure({
				statusCode,
				headers: { 'retry-after': header },
				body: { errors: [{ field: null, code, message: 'x' }] },
			});

			expect(failure).toMatchObject({
				outcome: 'not-sent',
				retryable: true,
				retryAfterSeconds: seconds,
				httpStatus: statusCode,
				codes: [code],
			});
			expect(failure.description).toContain('Nothing was sent');
		},
	);

	it('429 without a usable Retry-After is still retryable, with no wait hint', () => {
		const failure = interpretFailure({
			statusCode: 429,
			headers: { 'retry-after': 'soon' },
			body: '',
		});

		expect(failure.retryable).toBe(true);
		expect(failure.retryAfterSeconds).toBeUndefined();
	});

	it('500: outcome unknown, never retryable, says it may already have been sent and gives the trace ID', () => {
		const failure = interpretFailure({
			statusCode: 500,
			body: { error: 'An unexpected error occurred', traceId: 'trace-9' },
		});

		expect(failure).toMatchObject({
			outcome: 'unknown',
			retryable: false,
			httpStatus: 500,
			traceId: 'trace-9',
		});
		expect(failure.message).toMatch(/may already have been sent/);
		expect(failure.description).toContain('trace-9');
	});

	it.each([
		['502', { statusCode: 502, body: '<html>502</html>' }, 502],
		['504', { statusCode: 504, body: '<html>504</html>' }, 504],
		[
			'network timeout',
			{ networkError: { code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' } },
			undefined,
		],
	])(
		'%s: outcome unknown, never retryable, never suggests Retry on Fail',
		(_name, call, httpStatus) => {
			const failure = interpretFailure(call);

			expect(failure).toMatchObject({ outcome: 'unknown', retryable: false, httpStatus });
			expect(failure.message).toMatch(/may already have been sent/);
			expect(`${failure.message} ${failure.description}`).not.toMatch(/retry on fail/i);
		},
	);
});
