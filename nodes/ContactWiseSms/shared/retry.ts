import type { SendFailure } from './errors';

export const RETRY_POLICY = {
	maxAttempts: 3,
	maxTotalWaitMs: 60_000,
	defaultDelayMs: 1_000,
};

/**
 * How long to wait before trying again, or `undefined` to give up.
 * Only failures the API guarantees sent nothing (429, 503) are ever retried; there are no
 * idempotency keys yet, so retrying an uncertain outcome could deliver the SMS twice.
 */
export function nextRetryDelayMs(
	failure: SendFailure,
	{ attempts, waitedMs }: { attempts: number; waitedMs: number },
): number | undefined {
	if (!failure.retryable || failure.outcome !== 'not-sent') return undefined;
	if (attempts >= RETRY_POLICY.maxAttempts) return undefined;

	const delayMs =
		failure.retryAfterSeconds !== undefined
			? failure.retryAfterSeconds * 1000
			: RETRY_POLICY.defaultDelayMs;
	if (waitedMs + delayMs > RETRY_POLICY.maxTotalWaitMs) return undefined;

	return delayMs;
}
