import nock from 'nock';

/**
 * Fake ContactWise SMS API for tests. Every scenario mirrors a row of the error table in
 * docs/contactwise-sms-api.md; keep the two in sync. Messages are illustrative: node code
 * must branch on `code`, never on `message`.
 */

export const CW_BASE_URL = 'https://api.contactwise.io';
export const TEST_TENANT_ID = 'tenant-under-test';
export const TEST_API_KEY = 'test-api-key';

export const sendPath = (tenantId = TEST_TENANT_ID) => `/v1/sms/${tenantId}/send`;

export type SendScenario =
	| { status: number; body: unknown; headers?: Record<string, string> }
	| { networkError: { code: string; message: string } };

export const sendScenarios = {
	/** 200: queued, not delivered. */
	accepted: (messageId = 'msg-0001'): SendScenario => ({
		status: 200,
		body: { messageId, status: 'accepted', timestamp: '2026-09-22T10:00:00Z' },
	}),

	/** 400 with every broken rule listed. Default: bad sender + bad body. */
	validationErrors: (
		errors: Array<{ field: string | null; code: number | string; message: string }> = [
			{ field: 'from', code: 9002, message: 'Sender ID is not registered' },
			{ field: 'body', code: 9008, message: 'Message body does not match the template' },
		],
	): SendScenario => ({ status: 400, body: { errors } }),

	/** 400 from the framework for malformed or empty JSON: `errors` is keyed by field. */
	problemDetails: (): SendScenario => ({
		status: 400,
		headers: { 'Content-Type': 'application/problem+json' },
		body: {
			type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
			title: 'One or more validation errors occurred.',
			status: 400,
			errors: { $: ['The JSON value could not be converted.'] },
			traceId: '00-problem-details-trace-00',
		},
	}),

	/** 401 with an empty body: missing key, or key from another tenant. */
	unauthorized: (): SendScenario => ({ status: 401, body: '' }),

	/** 429: rate limited, nothing sent, safe to retry after `Retry-After` seconds. */
	rateLimited: (retryAfterSeconds = 2): SendScenario => ({
		status: 429,
		headers: { 'Retry-After': String(retryAfterSeconds) },
		body: { errors: [{ field: null, code: 9010, message: 'Rate limit exceeded' }] },
	}),

	/** 503: messaging backend down, nothing sent, safe to retry after `Retry-After` seconds. */
	unavailable: (retryAfterSeconds = 5): SendScenario => ({
		status: 503,
		headers: { 'Retry-After': String(retryAfterSeconds) },
		body: { errors: [{ field: null, code: 9011, message: 'Messaging service unavailable' }] },
	}),

	/** 500: outcome unknown, the SMS may have been sent. Never retry. */
	serverError: (traceId = 'trace-500-0001'): SendScenario => ({
		status: 500,
		body: { error: 'An unexpected error occurred', traceId },
	}),

	/** 502 from the gateway, not JSON: outcome unknown. */
	badGateway: (): SendScenario => ({
		status: 502,
		headers: { 'Content-Type': 'text/html' },
		body: '<html><body>502 Bad Gateway</body></html>',
	}),

	/** 504 from the gateway, not JSON: outcome unknown. */
	gatewayTimeout: (): SendScenario => ({
		status: 504,
		headers: { 'Content-Type': 'text/html' },
		body: '<html><body>504 Gateway Timeout</body></html>',
	}),

	/** Connection dropped or timed out: outcome unknown. */
	networkTimeout: (): SendScenario => ({
		networkError: { code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' },
	}),
};

export interface CapturedRequest {
	body: unknown;
	headers: Record<string, string | string[] | undefined>;
}

/**
 * Answers the next `POST /v1/sms/{tenantId}/send` with `scenario` and records what the node
 * sent. Register several in order to script a sequence, e.g. rateLimited() then accepted().
 */
export function interceptSend(scenario: SendScenario, tenantId = TEST_TENANT_ID) {
	const requests: CapturedRequest[] = [];
	const interceptor = nock(CW_BASE_URL).post(sendPath(tenantId), (body) => {
		requests.push({ body, headers: {} });
		return true;
	});

	// replyWithError needs a real Error instance: a plain object makes the request hang.
	const scope =
		'networkError' in scenario
			? interceptor.replyWithError(
					Object.assign(new Error(scenario.networkError.message), { code: scenario.networkError.code }),
				)
			: interceptor.reply(function reply() {
					requests[requests.length - 1].headers = this.req.headers;
					return [scenario.status, scenario.body as nock.Body, scenario.headers];
				});

	return { scope, requests };
}
