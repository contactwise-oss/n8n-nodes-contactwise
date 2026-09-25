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

/** What to do for the Meta codes users hit most. Anything else gets the general fix. */
function metaFixFor(code: number | undefined): string {
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
			return 'Check the WhatsApp message and recipient, then try again.';
	}
}

function supportTraceHint(traceId: string | undefined): string {
	return traceId ? ` If you contact ContactWise support, quote trace ID ${traceId}.` : '';
}

export type Channel = 'sms' | 'whatsapp';

/** How each channel names what it sends, so shared wording never says "SMS" for WhatsApp. */
const CHANNEL_WORDING: Record<Channel, { message: string; theMessage: string; messages: string }> =
	{
		sms: { message: 'SMS', theMessage: 'The SMS', messages: 'SMS' },
		whatsapp: {
			message: 'WhatsApp message',
			theMessage: 'The WhatsApp message',
			messages: 'WhatsApp messages',
		},
	};

function unknownOutcomeAdvice(channel: Channel): string {
	return `Don't send this item again automatically: the recipient may get the ${CHANNEL_WORDING[channel].message} twice. Check delivery reports first.`;
}

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

	if (call.networkError || statusCode === undefined || statusCode === 502 || statusCode === 504) {
		return {
			...base,
			outcome: 'unknown',
			retryable: false,
			messages: call.networkError?.message ? [call.networkError.message] : [],
			message: `${wording.theMessage} may already have been sent: the connection to ContactWise failed`,
			description: unknownOutcomeAdvice(channel),
		};
	}

	if (statusCode >= 500 && statusCode !== 503) {
		return {
			...base,
			outcome: 'unknown',
			retryable: false,
			messages: typeof body?.error === 'string' ? [body.error] : [],
			message: `${wording.theMessage} may already have been sent: ContactWise returned an unexpected response`,
			description: `${unknownOutcomeAdvice(channel)}${supportTraceHint(traceId)}`,
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
					? `ContactWise is limiting how fast ${wording.messages} can be sent`
					: 'The ContactWise messaging service is unavailable',
			description: 'Nothing was sent. Wait a few minutes and run the workflow again.',
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
			message: `WhatsApp rejected the message: ${meta.message}`,
			description: `Nothing was sent.${detail} ${metaFixFor(meta.code)}${supportTraceHint(traceId)}`,
		};
	}

	if (statusCode === 401) {
		return {
			...base,
			outcome: 'not-sent',
			retryable: false,
			messages: [],
			message: "The 'API Key' is invalid, or it doesn't belong to this tenant",
			description:
				"Nothing was sent. Check the 'API Key' and 'Tenant ID' in the ContactWise API credential.",
		};
	}

	if (statusCode === 400 && errorList) {
		const messages = errorList.map((entry) => entry.message ?? String(entry.code));
		return {
			...base,
			outcome: 'not-sent',
			retryable: false,
			messages,
			message: `ContactWise rejected the ${wording.message}: ${messages.join('; ')}`,
			description: `Nothing was sent. ${fixesFor(codes)}`,
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
			description:
				'Nothing was sent. Check that every field resolves to plain text, not an object or list.',
		};
	}

	return {
		...base,
		outcome: 'not-sent',
		retryable: false,
		messages: [],
		message: `ContactWise didn't accept the ${wording.message} (status ${statusCode})`,
		description: 'Nothing was sent. Check the node settings and the ContactWise API credential.',
	};
}
