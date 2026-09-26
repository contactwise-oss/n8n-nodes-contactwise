import { NodeApiError, sleep } from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	IN8nHttpFullResponse,
	INode,
	JsonObject,
} from 'n8n-workflow';

// Compiles to a require of dist/package.json, so that file must stay in the published package.
import { version } from '../../package.json';
import { interpretFailure, type Channel, type FailedCall, type SendFailure } from './errors';
import { nextRetryDelayMs } from './retry';

export const CONTACTWISE_BASE_URL = 'https://api.contactwise.io';

/**
 * Identifies the node and its version on every request. The API doesn't read it today: n8n
 * traffic is counted by the `source` body field on SMS send (TIN-6).
 */
export const SOURCE_HEADER = { 'X-CW-Source': `n8n-nodes-contactwise/${version}` };

/** Key under which the interpreted failure travels on NodeApiError.context. */
export const FAILURE_CONTEXT_KEY = 'contactWiseFailure';

/**
 * Builds the error from sanitized fields only. The raw request error is never attached:
 * it carries the request headers, including the API key.
 */
function toNodeApiError(
	node: INode,
	failure: SendFailure,
	itemIndex: number | undefined,
): NodeApiError {
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
			message: itemIndex === undefined ? failure.message : `${failure.message} [item ${itemIndex}]`,
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

/** A request the retry loop sends. Everything else (auth, base URL, headers) is fixed. */
interface ContactWiseRequest {
	method: IHttpRequestMethods;
	path: string;
	body?: IDataObject | FormData;
	/** `arraybuffer` returns the body as a Buffer, for file downloads. */
	encoding?: 'arraybuffer';
}

/** A file download's error body arrives as bytes too. Parses it when it's JSON. */
function parseBody(body: unknown): unknown {
	if (!Buffer.isBuffer(body)) return body;
	try {
		return JSON.parse(body.toString('utf8'));
	} catch {
		return undefined;
	}
}

/**
 * Sends one request, retrying only failures `interpretFailure` marks retryable, within the retry
 * policy. Returns the 2xx response, or throws a NodeApiError with our wording, which names what
 * the channel does (an SMS, a WhatsApp message, a media download).
 */
async function requestWithRetry(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	request: ContactWiseRequest,
	itemIndex: number | undefined,
	channel: Channel,
): Promise<IN8nHttpFullResponse> {
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
					method: request.method,
					url: `${CONTACTWISE_BASE_URL}${request.path}`,
					...(request.body !== undefined && { body: request.body }),
					...(request.encoding ? { encoding: request.encoding, json: false } : { json: true }),
					headers: SOURCE_HEADER,
					returnFullResponse: true,
					ignoreHttpStatusErrors: true,
				},
			)) as IN8nHttpFullResponse;
			if (response.statusCode >= 200 && response.statusCode < 300) return response;
			call = {
				statusCode: response.statusCode,
				body: parseBody(response.body),
				headers: response.headers,
			};
		} catch (error) {
			// No HTTP response at all (timeout, reset): the outcome is unknown.
			const code = networkErrorCode(error);
			call = { networkError: { code, message: code } };
		}

		const failure = interpretFailure(call, channel);
		const delayMs = nextRetryDelayMs(failure, { attempts, waitedMs });
		if (delayMs === undefined) throw toNodeApiError(this.getNode(), failure, itemIndex);

		await sleep(delayMs);
		waitedMs += delayMs;
	}
}

/**
 * Calls the ContactWise API, retrying only when the API guarantees nothing was sent (429/503)
 * and within the retry policy. Every other failure becomes a NodeApiError with our wording,
 * which names what the channel sends (an SMS or a WhatsApp message).
 */
export async function contactWiseApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	path: string,
	/** `undefined` for requests without a body, e.g. GET. */
	body: IDataObject | FormData | undefined,
	/** The input item, or `undefined` outside item execution (dropdowns). */
	itemIndex: number | undefined,
	channel: Channel,
): Promise<IDataObject> {
	const response = await requestWithRetry.call(this, { method, path, body }, itemIndex, channel);
	return response.body as IDataObject;
}

/**
 * Downloads a file with `GET`. Returns its bytes and the response headers (names lowercased).
 * Retries follow `channel`: a read-only channel also retries 502/504 and broken connections.
 */
export async function contactWiseApiDownload(
	this: IExecuteFunctions,
	path: string,
	itemIndex: number,
	channel: Channel,
): Promise<{ data: Buffer; headers: IDataObject }> {
	const response = await requestWithRetry.call(
		this,
		{ method: 'GET', path, encoding: 'arraybuffer' },
		itemIndex,
		channel,
	);
	return { data: Buffer.from(response.body as ArrayBuffer), headers: response.headers };
}
