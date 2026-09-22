import { describe, expect, it } from 'vitest';

import { interpretFailure } from '../../nodes/ContactWiseSms/shared/errors';
import { nextRetryDelayMs } from '../../nodes/ContactWiseSms/shared/retry';

// Policy from docs/contactwise-sms-api.md and TIN-13: retry only 429/503, honour Retry-After,
// at most 3 attempts and 60 s of total waiting.
const rateLimited = (retryAfter?: string) =>
	interpretFailure({
		statusCode: 429,
		headers: retryAfter ? { 'retry-after': retryAfter } : {},
		body: '',
	});

describe('nextRetryDelayMs', () => {
	it('waits for Retry-After before the second attempt', () => {
		expect(nextRetryDelayMs(rateLimited('2'), { attempts: 1, waitedMs: 0 })).toBe(2000);
	});

	it('waits 1 second when Retry-After gives no usable hint', () => {
		expect(nextRetryDelayMs(rateLimited(), { attempts: 1, waitedMs: 0 })).toBe(1000);
	});

	it('allows a third attempt but never a fourth', () => {
		expect(nextRetryDelayMs(rateLimited('1'), { attempts: 2, waitedMs: 1000 })).toBe(1000);
		expect(nextRetryDelayMs(rateLimited('1'), { attempts: 3, waitedMs: 2000 })).toBeUndefined();
	});

	it('gives up when waiting would exceed 60 seconds in total', () => {
		expect(nextRetryDelayMs(rateLimited('2'), { attempts: 2, waitedMs: 59_000 })).toBeUndefined();
		expect(nextRetryDelayMs(rateLimited('120'), { attempts: 1, waitedMs: 0 })).toBeUndefined();
	});

	it.each([
		['500', interpretFailure({ statusCode: 500, body: { traceId: 't' } })],
		['network timeout', interpretFailure({ networkError: { code: 'ETIMEDOUT' } })],
		[
			'400',
			interpretFailure({ statusCode: 400, body: { errors: [{ code: 9007, message: 'x' }] } }),
		],
	])('never retries a %s', (_name, failure) => {
		expect(nextRetryDelayMs(failure, { attempts: 1, waitedMs: 0 })).toBeUndefined();
	});
});
