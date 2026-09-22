import { NodeApiError, sleep } from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IN8nHttpFullResponse,
	INode,
	JsonObject,
} from 'n8n-workflow';

import { version } from '../../../package.json';
import { interpretFailure, type FailedCall, type SendFailure } from './errors';
import { nextRetryDelayMs } from './retry';

export const CONTACTWISE_BASE_URL = 'https://api.contactwise.io';

/** Lets ContactWise count traffic that comes from n8n (TIN-6). */
export const SOURCE_HEADER = { 'X-CW-Source': `n8n-nodes-contactwise/${version}` };

/** Key under which the interpreted failure travels on NodeApiError.context. */
export const FAILURE_CONTEXT_KEY = 'contactWiseFailure';

/**
 * Builds the error from sanitized fields only. The raw request error is never attached:
 * it carries the request headers, including the API key.
 */
function toNodeApiError(node: INode, failure: SendFailure, itemIndex: number): NodeApiError {
	const error = new NodeApiError(
		node,
		{
			message: failure.message,
			httpStatus: failure.httpStatus ?? null,
			codes: failure.codes,
			messages: failure.messages,
			traceId: failure.traceId ?? null,
		} as JsonObject,
		{
			message: `${failure.message} [item ${itemIndex}]`,
			description: failure.description,
			httpCode: failure.httpStatus !== undefined ? String(failure.httpStatus) : undefined,
			itemIndex,
		},
	);
	error.context[FAILURE_CONTEXT_KEY] = { ...failure };
	return error;
}

function networkErrorCode(error: unknown): string | undefined {
	const candidate = error as { code?: unknown; cause?: { code?: unknown } };
	const code = candidate.cause?.code ?? candidate.code;
	return typeof code === 'string' ? code : undefined;
}

/**
 * Calls the ContactWise API, retrying only when the API guarantees nothing was sent (429/503)
 * and within the retry policy. Every other failure becomes a NodeApiError with our wording.
 */
export async function contactWiseApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	body: IDataObject,
	itemIndex: number,
): Promise<IDataObject> {
	let attempts = 0;
	let waitedMs = 0;

	for (;;) {
		attempts++;
		let call: FailedCall;
		try {
			const response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'contactWiseApi',
				{
					method,
					url: `${CONTACTWISE_BASE_URL}${path}`,
					body,
					json: true,
					headers: SOURCE_HEADER,
					returnFullResponse: true,
					ignoreHttpStatusErrors: true,
				},
			)) as IN8nHttpFullResponse;
			if (response.statusCode >= 200 && response.statusCode < 300) {
				return response.body as IDataObject;
			}
			call = { statusCode: response.statusCode, body: response.body, headers: response.headers };
		} catch (error) {
			// No HTTP response at all (timeout, reset): the outcome is unknown.
			const code = networkErrorCode(error);
			call = { networkError: { code, message: code } };
		}

		const failure = interpretFailure(call);
		const delayMs = nextRetryDelayMs(failure, { attempts, waitedMs });
		if (delayMs === undefined) throw toNodeApiError(this.getNode(), failure, itemIndex);

		await sleep(delayMs);
		waitedMs += delayMs;
	}
}
