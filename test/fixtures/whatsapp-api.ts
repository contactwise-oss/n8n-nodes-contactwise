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
	const requests: CapturedGatewayRequest[] = [];
	const path = gatewayPath(graphPath, tenantId);
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
