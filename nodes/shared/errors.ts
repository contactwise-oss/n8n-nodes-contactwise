/**
 * Turns a failed ContactWise API call into what the user sees and whether it's safe to retry.
 * Mirrors the error table in docs/contactwise-sms-api.md. Branch on `code`, never on `message`.
 */

export interface FailedCall {
	statusCode?: number;
	body?: unknown;
	headers?: Record<string, unknown>;
	/** Set when no HTTP response arrived (timeout, connection reset). */
	networkError?: { code?: string; message?: string };
}

export interface SendFailure {
	/** `not-sent`: the API guarantees nothing went out. `unknown`: the message may have been sent. */
	outcome: 'not-sent' | 'unknown';
	retryable: boolean;
	retryAfterSeconds?: number;
	httpStatus?: number;
	codes: Array<number | string>;
	messages: string[];
	traceId?: string;
	message: string;
	description: string;
}

interface ApiErrorEntry {
	field?: string | null;
	code?: number | string;
	message?: string;
}

/** What to check for each documented validation code. */
const FIX_BY_CODE: Array<{ codes: number[]; fix: string }> = [
	{ codes: [1001], fix: "Check the 'Tenant ID' in the ContactWise API credential." },
	{ codes: [9000], fix: 'Only recipients in India are supported.' },
	{
		codes: [9002, 9003, 9004],
		fix: "Check that 'Sender ID' is registered on DLT and active for your account.",
	},
	{ codes: [9007], fix: "Check the 'To' value." },
	{
		codes: [9008, 9009],
		fix: "Check that 'Message' matches the content registered under 'DLT Template ID'.",
	},
];

const DOCUMENTED_CODES = new Set(FIX_BY_CODE.flatMap(({ codes }) => codes));
const GENERAL_FIX = 'Check the values listed above and try again.';

function fixesFor(codes: Array<number | string>): string {
	const numeric = codes.map(Number);
	const fixes = FIX_BY_CODE.filter(({ codes: known }) =>
		known.some((code) => numeric.includes(code)),
	).map(({ fix }) => fix);
	if (fixes.length === 0 || numeric.some((code) => !DOCUMENTED_CODES.has(code))) {
		fixes.push(GENERAL_FIX);
	}
	return fixes.join(' ');
}

/** API request fields → the parameter names users see. */
const FIELD_DISPLAY_NAMES: Record<string, string> = {
	from: "'Sender ID'",
	to: "'To'",
	body: "'Message'",
	templateid: "'DLT Template ID'",
	entityid: "'DLT Entity ID'",
	servicetype: "'Service Type'",
	messagetype: "'Message Type'",
	flash: "'Flash'",
	customid: "'Custom ID'",
	metadata: "'Metadata'",
	callbackurl: "'Callback URL'",
};

/** `$.to`, `To` and `to` all name the 'To' field; anything unknown is "the request". */
function displayNameFor(apiField: string): string {
	const key = apiField.replace(/^\$\.?/, '').toLowerCase();
	return FIELD_DISPLAY_NAMES[key] ?? 'the request';
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Whole seconds per the API; anything else (missing, dates, junk) gives no hint. */
function parseRetryAfter(headers: Record<string, unknown> | undefined): number | undefined {
	const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
	const seconds = Number(Array.isArray(raw) ? raw[0] : raw);
	return Number.isInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Meta's Graph API error envelope: `{ error: { message, type, code, error_data, fbtrace_id } }`. */
interface MetaError {
	code?: number;
	message: string;
	details?: string;
	fbtraceId?: string;
}

function metaErrorFrom(body: Record<string, unknown> | undefined): MetaError | undefined {
	const error = asObject(body?.error);
	if (!error || typeof error.message !== 'string') return undefined;
	const details = asObject(error.error_data)?.details;
	return {
		code: typeof error.code === 'number' ? error.code : undefined,
		// Meta prefixes messages with the code, e.g. "(#100) Invalid parameter".
		message: error.message.replace(/^\(#\d+\)\s*/, ''),
		details: typeof details === 'string' ? details : undefined,
		fbtraceId: typeof error.fbtrace_id === 'string' ? error.fbtrace_id : undefined,
	};
}

/** What to do for the Meta codes users hit most. Anything else gets the channel's general fix. */
function metaFixFor(code: number | undefined, generalFix: string): string {
	switch (code) {
		case 131047:
			return 'More than 24 hours have passed since the recipient last messaged you, so only a template can be sent. Send an approved template instead.';
		case 130429:
			return "Your WhatsApp number's sending limit was reached. Send more slowly, then run the workflow again.";
		case 131056:
			return 'Too many messages went to this recipient in a short time. Wait before sending to this recipient again.';
		case 131026:
			return "The recipient can't receive this message. Check that the number is on WhatsApp and uses a recent app version.";
		default:
			if (code !== undefined && code >= 132000 && code < 133000) {
				return 'Check that the template exists in this language, is approved and active, and that the parameters match it.';
			}
			return generalFix;
	}
}

function supportTraceHint(traceId: string | undefined): string {
	return traceId ? ` If you contact ContactWise support, quote trace ID ${traceId}.` : '';
}

/** What a call does: send an SMS or WhatsApp message, or upload, delete or download a WhatsApp media file. */
export type Channel =
	| 'sms'
	| 'whatsapp'
	| 'whatsapp-upload'
	| 'whatsapp-delete'
	| 'whatsapp-download';

interface Wording {
	/** "The SMS may already have been …" */
	theThing: string;
	/** "limiting how fast … can be …" */
	things: string;
	/** Past participle: "sent", "uploaded". */
	done: string;
	/** "ContactWise rejected …", "ContactWise didn't accept …" */
	request: string;
	/** "WhatsApp rejected …" */
	metaRequest: string;
	/** Opens every not-sent description. */
	nothingDone: string;
	/** The 503 message. */
	unavailable: string;
	/** What to do when the outcome is unknown. */
	unknownAdvice: string;
	/** The fix for a Meta code with no specific one. */
	metaGeneralFix: string;
	/**
	 * Set for calls with no side effects. A failed connection or a 502/504 then can't have done
	 * anything twice, so it's retried like a 429/503, and the wording names what failed instead.
	 */
	readOnly?: { failed: string; notFound: string };
}

const SEND_ADVICE = (thing: string) =>
	`Don't send this item again automatically: the recipient may get the ${thing} twice. Check delivery reports first.`;

/** How each channel names what it does, so an upload never reads as "sent" and WhatsApp never as "SMS". */
const CHANNEL_WORDING: Record<Channel, Wording> = {
	sms: {
		theThing: 'The SMS',
		things: 'SMS',
		done: 'sent',
		request: 'the SMS',
		metaRequest: 'the message',
		nothingDone: 'Nothing was sent.',
		unavailable: 'The ContactWise messaging service is unavailable',
		unknownAdvice: SEND_ADVICE('SMS'),
		metaGeneralFix: GENERAL_FIX,
	},
	whatsapp: {
		theThing: 'The WhatsApp message',
		things: 'WhatsApp messages',
		done: 'sent',
		request: 'the WhatsApp message',
		metaRequest: 'the message',
		nothingDone: 'Nothing was sent.',
		unavailable: 'The ContactWise messaging service is unavailable',
		unknownAdvice: SEND_ADVICE('WhatsApp message'),
		metaGeneralFix: 'Check the WhatsApp message and recipient, then try again.',
	},
	'whatsapp-upload': {
		theThing: 'The media file',
		things: 'media files',
		done: 'uploaded',
		request: 'the upload',
		metaRequest: 'the upload',
		nothingDone: 'Nothing was uploaded.',
		unavailable: "ContactWise can't upload media right now",
		unknownAdvice:
			"Don't upload this file again automatically: WhatsApp may store it twice. Run the workflow again only if you need a new media ID.",
		metaGeneralFix: "Check that WhatsApp supports the file's type and size, then try again.",
	},
	'whatsapp-delete': {
		theThing: 'The media file',
		things: 'media files',
		done: 'deleted',
		request: 'the delete request',
		metaRequest: 'the delete request',
		nothingDone: 'Nothing was deleted.',
		unavailable: "ContactWise can't delete media right now",
		unknownAdvice: 'Check whether the media file still exists before trying again.',
		metaGeneralFix: "Check the 'Media ID', then try again.",
	},
	'whatsapp-download': {
		theThing: 'The media file',
		things: 'media files',
		done: 'downloaded',
		request: 'the download request',
		metaRequest: 'the download request',
		nothingDone: 'Nothing was downloaded.',
		unavailable: "ContactWise can't download media right now",
		unknownAdvice: 'Wait a few minutes and run the workflow again.',
		metaGeneralFix: "Check the 'Media ID', then try again.",
		readOnly: {
			failed: "The media file wasn't downloaded",
			notFound:
				"Check the 'Media ID'. WhatsApp keeps media for 30 days, and you can only download media from your own WhatsApp Business Account.",
		},
	},
};

export function interpretFailure(call: FailedCall, channel: Channel = 'sms'): SendFailure {
	const wording = CHANNEL_WORDING[channel];
	const { statusCode } = call;
	const body = asObject(call.body);
	const meta = metaErrorFrom(body);
	const traceId = typeof body?.traceId === 'string' ? body.traceId : meta?.fbtraceId;
	const errorList = Array.isArray(body?.errors) ? (body.errors as ApiErrorEntry[]) : undefined;
	const errorMap = !errorList && asObject(body?.errors);
	const entries: Array<{ code?: number | string }> = meta ? [meta] : (errorList ?? []);
	const codes = entries.map((entry) => entry.code).filter((code) => code !== undefined) as Array<
		number | string
	>;
	const base = { httpStatus: statusCode, codes, traceId };
	const gatewayMessage = typeof body?.error === 'string' ? body.error : undefined;
	const { readOnly } = wording;

	if (call.networkError || statusCode === undefined || statusCode === 502 || statusCode === 504) {
		if (readOnly) {
			return {
				...base,
				outcome: 'not-sent',
				retryable: true,
				messages: call.networkError?.message
					? [call.networkError.message]
					: gatewayMessage
						? [gatewayMessage]
						: [],
				message: `${readOnly.failed}: the connection to ContactWise failed`,
				description: `${wording.nothingDone} ${wording.unknownAdvice}`,
			};
		}
		return {
			...base,
			outcome: 'unknown',
			retryable: false,
			messages: call.networkError?.message ? [call.networkError.message] : [],
			message: `${wording.theThing} may already have been ${wording.done}: the connection to ContactWise failed`,
			description: wording.unknownAdvice,
		};
	}

	if (statusCode >= 500 && statusCode !== 503) {
		if (readOnly) {
			return {
				...base,
				outcome: 'not-sent',
				retryable: false,
				messages: gatewayMessage ? [gatewayMessage] : [],
				message: `${readOnly.failed}: ContactWise returned an unexpected response`,
				description: `${wording.nothingDone} ${wording.unknownAdvice}${supportTraceHint(traceId)}`,
			};
		}
		return {
			...base,
			outcome: 'unknown',
			retryable: false,
			messages: typeof body?.error === 'string' ? [body.error] : [],
			message: `${wording.theThing} may already have been ${wording.done}: ContactWise returned an unexpected response`,
			description: `${wording.unknownAdvice}${supportTraceHint(traceId)}`,
		};
	}

	if (statusCode === 429 || statusCode === 503) {
		return {
			...base,
			outcome: 'not-sent',
			retryable: true,
			retryAfterSeconds: parseRetryAfter(call.headers),
			messages: (errorList ?? []).map((entry) => entry.message ?? String(entry.code)),
			message:
				statusCode === 429
					? `ContactWise is limiting how fast ${wording.things} can be ${wording.done}`
					: wording.unavailable,
			description: `${wording.nothingDone} Wait a few minutes and run the workflow again.`,
		};
	}

	if (meta) {
		// Meta's detail may lack a full stop; end it so it doesn't run into the fix.
		const detail = meta.details ? ` ${meta.details.replace(/[.!?]$/, '')}.` : '';
		return {
			...base,
			outcome: 'not-sent',
			retryable: false,
			messages: [meta.message],
			message: `WhatsApp rejected ${wording.metaRequest}: ${meta.message}`,
			description: `${wording.nothingDone}${detail} ${metaFixFor(meta.code, wording.metaGeneralFix)}${supportTraceHint(traceId)}`,
		};
	}

	if (statusCode === 401) {
		return {
			...base,
			outcome: 'not-sent',
			retryable: false,
			messages: [],
			message: "The 'API Key' is invalid, or it doesn't belong to this tenant",
			description: `${wording.nothingDone} Check the 'API Key' and 'Tenant ID' in the ContactWise API credential.`,
		};
	}

	if (statusCode === 404 && readOnly) {
		return {
			...base,
			outcome: 'not-sent',
			retryable: false,
			messages: gatewayMessage ? [gatewayMessage] : [],
			message: `${wording.theThing} wasn't found`,
			description: `${wording.nothingDone} ${readOnly.notFound}`,
		};
	}

	if (statusCode === 400 && errorList) {
		const messages = errorList.map((entry) => entry.message ?? String(entry.code));
		return {
			...base,
			outcome: 'not-sent',
			retryable: false,
			messages,
			message: `ContactWise rejected ${wording.request}: ${messages.join('; ')}`,
			description: `${wording.nothingDone} ${fixesFor(codes)}`,
		};
	}

	if (statusCode === 400 && errorMap) {
		const messages = Object.entries(errorMap).flatMap(([field, problems]) =>
			(Array.isArray(problems) ? problems : [problems]).map(
				(problem) => `${displayNameFor(field)}: ${String(problem)}`,
			),
		);
		return {
			...base,
			outcome: 'not-sent',
			retryable: false,
			messages,
			message: `ContactWise couldn't read the request: ${messages.join('; ')}`,
			description: `${wording.nothingDone} Check that every field resolves to plain text, not an object or list.`,
		};
	}

	// The gateway's own errors: `{ "error": "<message>" }` (TIN-33).
	if (gatewayMessage) {
		return {
			...base,
			outcome: 'not-sent',
			retryable: false,
			messages: [gatewayMessage],
			message: `ContactWise rejected ${wording.request}: ${gatewayMessage}`,
			description: `${wording.nothingDone} ${wording.metaGeneralFix}`,
		};
	}

	return {
		...base,
		outcome: 'not-sent',
		retryable: false,
		messages: [],
		message: `ContactWise didn't accept ${wording.request} (status ${statusCode})`,
		description: `${wording.nothingDone} Check the node settings and the ContactWise API credential.`,
	};
}
