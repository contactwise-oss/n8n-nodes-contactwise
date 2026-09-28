import nock from 'nock';

import { CW_BASE_URL, TEST_TENANT_ID, type CapturedRequest } from './contactwise-api';

/**
 * Fake ContactWise WhatsApp gateway for tests. Shapes follow docs/contactwise-whatsapp-api.md,
 * which follows Meta's Cloud API reference. Messages are illustrative: node code must branch
 * on `code`, never on `message`.
 */

export const TEST_WABA_ID = '100000000000001';
export const TEST_PHONE_NUMBER_ID = '100000000000002';

export const gatewayPath = (graphPath: string, tenantId = TEST_TENANT_ID) =>
	`/v1/waba-direct/${tenantId}/${graphPath}`;

/** The gateway's own media download route, outside the `/v1/waba-direct/` proxy (TIN-33). */
export const mediaDownloadPath = (mediaId: string, tenantId = TEST_TENANT_ID) =>
	`/v1/whatsapp/${tenantId}/media/${mediaId}/content`;

export type GatewayScenario =
	| { status: number; body: unknown; headers?: Record<string, string> }
	| { networkError: { code: string; message: string } };

export const whatsAppScenarios = {
	/** 200 from `POST /{phone-number-id}/messages`: accepted by Meta, not delivered. */
	messageAccepted: (
		to = '447700900123',
		id = 'wamid.HBgLNDQ3NzAwOTAwMTIzFQIAERgSMA==',
	): GatewayScenario => ({
		status: 200,
		body: {
			messaging_product: 'whatsapp',
			contacts: [{ input: to, wa_id: to }],
			messages: [{ id }],
		},
	}),

	/** 200 from `POST /{phone-number-id}/media`. */
	mediaUploaded: (id = '1000000000000004'): GatewayScenario => ({ status: 200, body: { id } }),

	/** 200 from `DELETE /{media-id}`. */
	mediaDeleted: (): GatewayScenario => ({ status: 200, body: { success: true } }),

	/** 200 from `GET /{waba-id}/phone_numbers`. */
	phoneNumbers: (
		data: Array<{ id: string; display_phone_number: string; verified_name: string }>,
	): GatewayScenario => ({
		status: 200,
		body: { data, paging: { cursors: { before: 'b', after: 'a' } } },
	}),

	/**
	 * 200 from `GET /{waba-id}/message_templates`. `after` set means another page exists:
	 * Meta then includes `paging.next`.
	 */
	templates: (
		data: Array<{ name: string; language: string; status?: string }>,
		after?: string,
	): GatewayScenario => ({
		status: 200,
		body: {
			data: data.map((template, index) => ({
				id: `${9000 + index}`,
				status: 'APPROVED',
				category: 'UTILITY',
				components: [],
				...template,
			})),
			paging: {
				cursors: { before: 'before-cursor', after: after ?? 'last-cursor' },
				...(after && { next: `https://graph.facebook.com/v23.0/next?after=${after}` }),
			},
		},
	}),

	/** 4xx with Meta's error envelope. */
	metaError: (
		code: number,
		message: string,
		{
			status = 400,
			details,
			fbtraceId = 'AbCdEfGh123',
		}: { status?: number; details?: string; fbtraceId?: string } = {},
	): GatewayScenario => ({
		status,
		body: {
			error: {
				message: `(#${code}) ${message}`,
				type: 'OAuthException',
				code,
				...(details && { error_data: { messaging_product: 'whatsapp', details } }),
				fbtrace_id: fbtraceId,
			},
		},
	}),

	/** 500 from Meta through the gateway: outcome unknown. Never retry. */
	serverError: (): GatewayScenario => ({
		status: 500,
		body: {
			error: { message: '(#131000) Something went wrong', code: 131000, fbtrace_id: 'Tr4ce500' },
		},
	}),

	/** Connection dropped or timed out: outcome unknown. */
	networkTimeout: (): GatewayScenario => ({
		networkError: { code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' },
	}),

	/** 200 from the media download route: the file's bytes, with the gateway's headers. */
	mediaFile: (
		bytes: Buffer,
		{
			contentType,
			fileName,
			sha256 = 'fake-sha256',
		}: { contentType: string; fileName: string; sha256?: string },
	): GatewayScenario => ({
		status: 200,
		body: bytes,
		headers: {
			'Content-Type': contentType,
			'Content-Length': String(bytes.length),
			'Content-Disposition': `attachment; filename="${fileName}"`,
			'X-CW-Media-SHA256': sha256,
		},
	}),

	/** An error the gateway itself returns: `{ "error": "<message>" }`. */
	gatewayError: (
		status: number,
		message: string,
		headers: Record<string, string> = {},
	): GatewayScenario => ({
		status,
		body: { error: message },
		headers: { 'Content-Type': 'application/json', ...headers },
	}),
};

export interface CapturedGatewayRequest extends CapturedRequest {
	path: string;
}

/**
 * Answers the next request to `method` + gateway `graphPath` with `scenario`, and records
 * what the node sent. The body is recorded as parsed JSON, or as the raw string for
 * multipart uploads.
 */
export function interceptGateway(
	method: 'get' | 'post' | 'delete',
	graphPath: string,
	scenario: GatewayScenario,
	tenantId = TEST_TENANT_ID,
) {
	return interceptPath(method, gatewayPath(graphPath, tenantId), scenario);
}

/** Answers the next media download for `mediaId` with `scenario`. */
export function interceptMediaDownload(
	mediaId: string,
	scenario: GatewayScenario,
	tenantId = TEST_TENANT_ID,
) {
	return interceptPath('get', mediaDownloadPath(mediaId, tenantId), scenario);
}

function interceptPath(method: 'get' | 'post' | 'delete', path: string, scenario: GatewayScenario) {
	const requests: CapturedGatewayRequest[] = [];
	const interceptor = nock(CW_BASE_URL).intercept(
		(uri) => uri.split('?')[0] === path,
		method.toUpperCase(),
		(body) => {
			requests.push({ body, headers: {}, path });
			return true;
		},
	);

	const scope =
		'networkError' in scenario
			? interceptor.replyWithError(
					Object.assign(new Error(scenario.networkError.message), {
						code: scenario.networkError.code,
					}),
				)
			: interceptor.reply(function reply(uri, body) {
					if (requests.length === 0) requests.push({ body, headers: {}, path });
					const last = requests[requests.length - 1];
					last.headers = this.req.headers;
					last.path = uri;
					return [scenario.status, scenario.body as nock.Body, scenario.headers];
				});

	return { scope, requests };
}

/** The gateway's webhook subscription routes (TIN-34), outside the `/v1/waba-direct/` proxy. */
export const webhooksPath = (subscriptionId?: string, tenantId = TEST_TENANT_ID) =>
	`/v1/whatsapp/${tenantId}/webhooks${subscriptionId ? `/${subscriptionId}` : ''}`;

export interface Subscription {
	id: string;
	url: string;
	fields: string[];
	description?: string | null;
	status: 'active' | 'disabled';
	createdAt?: string;
}

/** Responses of the subscription routes, as recorded in the TIN-34 spec's Status section. */
export const webhookScenarios = {
	/** 201 from `POST .../webhooks`: the subscription and its secret, returned only here. */
	created: (subscription: Subscription, secret: string): GatewayScenario => ({
		status: 201,
		body: { ...subscription, secret, createdAt: '2026-09-28T10:15:00.123Z' },
	}),
	/** 200 from `GET .../webhooks`: newest first, never with secrets. */
	listed: (subscriptions: Subscription[]): GatewayScenario => ({
		status: 200,
		body: { data: subscriptions },
	}),
	/** 204 from `DELETE .../webhooks/{id}`. */
	deleted: (): GatewayScenario => ({ status: 204, body: '' }),
	/** 404 from `DELETE`: missing, or another tenant's; the same response for both. */
	notFound: (): GatewayScenario => ({
		status: 404,
		body: { error: 'Webhook subscription not found.' },
	}),
	/** 400 naming the problem, e.g. a private or non-https URL. */
	rejected: (error: string): GatewayScenario => ({ status: 400, body: { error } }),
	/** 409 for the 51st subscription. */
	limitReached: (): GatewayScenario => ({
		status: 409,
		body: { error: 'This tenant already has 50 webhook subscriptions.' },
	}),
	invalidKey: (): GatewayScenario => ({ status: 401, body: { error: 'Invalid API key.' } }),
	rateLimited: (): GatewayScenario => ({
		status: 429,
		body: { error: 'Too many requests.' },
		headers: { 'Retry-After': '10' },
	}),
};

/** Answers the next call to a webhook subscription route with `scenario`. */
export function interceptWebhooks(
	method: 'get' | 'post' | 'delete',
	subscriptionId: string | undefined,
	scenario: GatewayScenario,
	tenantId = TEST_TENANT_ID,
) {
	return interceptPath(method, webhooksPath(subscriptionId, tenantId), scenario);
}
