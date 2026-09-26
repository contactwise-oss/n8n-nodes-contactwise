import { describe, expect, it } from 'vitest';

import { interpretFailure } from '../../nodes/shared/errors';

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

	describe('WhatsApp channel', () => {
		it('timeout: says the WhatsApp message, not an SMS, may already have been sent', () => {
			const failure = interpretFailure(
				{ networkError: { code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' } },
				'whatsapp',
			);

			expect(failure.outcome).toBe('unknown');
			expect(failure.message).toBe(
				'The WhatsApp message may already have been sent: the connection to ContactWise failed',
			);
			expect(`${failure.message} ${failure.description}`).not.toMatch(/SMS/);
		});

		it.each([
			[
				'500',
				{ statusCode: 500, body: { error: 'An unexpected error occurred' } },
				'The WhatsApp message may already have been sent: ContactWise returned an unexpected response',
			],
			[
				'429',
				{ statusCode: 429, body: {} },
				'ContactWise is limiting how fast WhatsApp messages can be sent',
			],
			[
				'400 errors[]',
				{ statusCode: 400, body: { errors: [{ code: 9999, message: 'Bad value' }] } },
				'ContactWise rejected the WhatsApp message: Bad value',
			],
			[
				'unmapped status',
				{ statusCode: 404, body: {} },
				"ContactWise didn't accept the WhatsApp message (status 404)",
			],
			[
				'gateway error body',
				{ statusCode: 403, body: { error: 'Tenant is suspended.' } },
				'ContactWise rejected the WhatsApp message: Tenant is suspended.',
			],
		])('%s: names the WhatsApp message, never an SMS', (_name, call, message) => {
			const failure = interpretFailure(call, 'whatsapp');

			expect(failure.message).toBe(message);
			expect(`${failure.message} ${failure.description}`).not.toMatch(/SMS/);
		});
	});

	// Meta's Graph API error envelope, passed through unchanged by the WhatsApp gateway.
	// Shapes and codes from Meta's WhatsApp Cloud API error reference.
	describe('Meta error envelope', () => {
		it('400: not sent, strips the (#code) prefix, keeps the code, details and fbtrace_id', () => {
			const failure = interpretFailure(
				{
					statusCode: 400,
					body: {
						error: {
							message: '(#100) Invalid parameter',
							type: 'OAuthException',
							code: 100,
							error_data: { messaging_product: 'whatsapp', details: 'Param to is not valid' },
							fbtrace_id: 'AbC123',
						},
					},
				},
				'whatsapp',
			);

			expect(failure).toMatchObject({
				outcome: 'not-sent',
				retryable: false,
				httpStatus: 400,
				codes: [100],
				messages: ['Invalid parameter'],
				traceId: 'AbC123',
				message: 'WhatsApp rejected the message: Invalid parameter',
			});
			expect(failure.description).toContain('Nothing was sent.');
			// Meta's detail has no full stop; it must not run into the next sentence.
			expect(failure.description).toContain('Nothing was sent. Param to is not valid. ');
			expect(failure.description).toContain('AbC123');
		});

		// Codes and meanings from Meta's WhatsApp Cloud API error code reference.
		it.each([
			[131047, 'Re-engagement message', 'Send an approved template instead.'],
			[130429, 'Rate limit hit', 'Send more slowly'],
			[
				131056,
				'(Business Account, Consumer Account) pair rate limit hit',
				'Wait before sending to this recipient again.',
			],
			[131026, 'Message undeliverable', 'Check that the number is on WhatsApp'],
			[132000, 'Number of parameters does not match the expected number of params', 'template'],
			[132001, 'Template name does not exist in the translation', 'template'],
			[132015, 'Template is paused', 'template'],
		])('%i: adds the specific fix, not the general one', (code, message, fix) => {
			const failure = interpretFailure(
				{ statusCode: 400, body: { error: { message: `(#${code}) ${message}`, code } } },
				'whatsapp',
			);

			expect(failure.codes).toEqual([code]);
			expect(failure.description).toContain(fix);
			expect(failure.description).not.toContain('Check the values listed above');
		});

		it('429 with a Meta body stays retryable: the gateway guarantees nothing was sent', () => {
			const failure = interpretFailure(
				{
					statusCode: 429,
					headers: { 'retry-after': '5' },
					body: { error: { message: '(#130429) Rate limit hit', code: 130429 } },
				},
				'whatsapp',
			);

			expect(failure).toMatchObject({ outcome: 'not-sent', retryable: true, retryAfterSeconds: 5 });
		});

		it('500 with a Meta body: outcome unknown, never retryable, quotes the fbtrace_id', () => {
			const failure = interpretFailure(
				{
					statusCode: 500,
					body: {
						error: { message: '(#131000) Something went wrong', code: 131000, fbtrace_id: 'Tr4ce' },
					},
				},
				'whatsapp',
			);

			expect(failure).toMatchObject({ outcome: 'unknown', retryable: false, traceId: 'Tr4ce' });
			expect(failure.message).toMatch(/may already have been sent/);
			expect(failure.description).toContain('Tr4ce');
		});
	});

	// Media → Upload and Delete (TIN-42) send no message, so their wording never says one was sent.
	describe.each([
		[
			'whatsapp-upload',
			{
				unavailable: "ContactWise can't upload media right now",
				timeout:
					'The media file may already have been uploaded: the connection to ContactWise failed',
				rateLimited: 'ContactWise is limiting how fast media files can be uploaded',
				meta: 'WhatsApp rejected the upload: Invalid parameter',
				nothingDone: 'Nothing was uploaded.',
			},
		],
		[
			'whatsapp-delete',
			{
				unavailable: "ContactWise can't delete media right now",
				timeout:
					'The media file may already have been deleted: the connection to ContactWise failed',
				rateLimited: 'ContactWise is limiting how fast media files can be deleted',
				meta: 'WhatsApp rejected the delete request: Invalid parameter',
				nothingDone: 'Nothing was deleted.',
			},
		],
	] as const)('%s channel', (channel, expected) => {
		it('503: says the media action is unavailable, not the messaging service', () => {
			expect(interpretFailure({ statusCode: 503, body: {} }, channel).message).toBe(
				expected.unavailable,
			);
		});

		it('timeout: names the media file and what may have happened to it', () => {
			const failure = interpretFailure({ networkError: { code: 'ETIMEDOUT' } }, channel);

			expect(failure.message).toBe(expected.timeout);
			expect(failure.description).not.toMatch(/sent|recipient|SMS/i);
		});

		it('429 and Meta rejections: say what was not done, never "sent"', () => {
			const limited = interpretFailure({ statusCode: 429, body: {} }, channel);
			const rejected = interpretFailure(
				{ statusCode: 400, body: { error: { message: '(#100) Invalid parameter', code: 100 } } },
				channel,
			);

			expect(limited.message).toBe(expected.rateLimited);
			expect(limited.description.startsWith(expected.nothingDone)).toBe(true);
			expect(rejected.message).toBe(expected.meta);
			expect(rejected.description.startsWith(expected.nothingDone)).toBe(true);
			expect(`${rejected.description} ${limited.description}`).not.toMatch(
				/sent|WhatsApp message/i,
			);
		});
	});
});
