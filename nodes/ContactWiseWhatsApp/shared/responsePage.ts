/**
 * The pages a recipient sees when they open a Send and Wait link. Self-contained by design
 * (TIN-43): every value is HTML-escaped, and there's no JavaScript and no external asset, so the
 * pages don't depend on n8n internals and a strict Content-Security-Policy can be set.
 */

export const RESPONSE_PAGE_CSP =
	"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export type ResponseFieldType =
	| 'text'
	| 'textarea'
	| 'number'
	| 'email'
	| 'date'
	| 'dropdown'
	| 'checkbox';

export interface ResponseField {
	fieldLabel: string;
	fieldType: ResponseFieldType;
	requiredField?: boolean;
	/** Choices for a dropdown. */
	fieldOptions?: string[];
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const STYLE = `
body{margin:0;background:#f6f7f9;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2328}
main{max-width:30rem;margin:2rem auto;padding:1.5rem;background:#fff;border:1px solid #d8dde3;border-radius:.5rem}
h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0 0 1rem;white-space:pre-wrap}
label{display:block;font-weight:600;margin:1rem 0 .25rem}
input,select,textarea{width:100%;box-sizing:border-box;padding:.5rem;font:inherit;border:1px solid #b8c0cc;border-radius:.375rem}
input[type=checkbox]{width:auto}textarea{min-height:6rem}
button{margin-top:1.25rem;padding:.625rem 1.25rem;font:inherit;font-weight:600;color:#fff;background:#1f6feb;border:0;border-radius:.375rem}
.alert{padding:.75rem;background:#fff1f0;border:1px solid #f5c2c0;border-radius:.375rem}`;

function page(title: string, content: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>
${content}
</main></body>
</html>`;
}

function heading(title: string, description?: string): string {
	return `<h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ''}`;
}

/** One button that posts back, so only a person's tap (never a link preview) records an answer. */
export function renderConfirmPage({
	title,
	buttonLabel,
}: {
	title: string;
	buttonLabel: string;
}): string {
	return page(
		title,
		`${heading(title)}
<form method="post" action="">
<button type="submit">${escapeHtml(buttonLabel)}</button>
</form>`,
	);
}

function renderField(field: ResponseField, index: number): string {
	const name = `field-${index}`;
	const required = field.requiredField ? ' required' : '';
	const label = `<label for="${name}">${escapeHtml(field.fieldLabel)}${field.requiredField ? ' *' : ''}</label>`;

	switch (field.fieldType) {
		case 'textarea':
			return `${label}<textarea id="${name}" name="${name}"${required}></textarea>`;
		case 'dropdown': {
			const options = (field.fieldOptions ?? [])
				.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
				.join('');
			return `${label}<select id="${name}" name="${name}"${required}><option value=""></option>${options}</select>`;
		}
		case 'checkbox':
			return `<label><input type="checkbox" id="${name}" name="${name}"> ${escapeHtml(field.fieldLabel)}</label>`;
		default:
			return `${label}<input type="${field.fieldType}" id="${name}" name="${name}"${required}>`;
	}
}

export function renderFormPage({
	title,
	description,
	buttonLabel,
	fields,
	invalid,
}: {
	title: string;
	description?: string;
	buttonLabel: string;
	fields: ResponseField[];
	/** Labels to flag after a submission that couldn't be accepted. */
	invalid?: string[];
}): string {
	const alert = invalid?.length
		? `<p class="alert">Check these fields: ${invalid.map(escapeHtml).join(', ')}</p>`
		: '';
	return page(
		title,
		`${heading(title, description)}${alert}
<form method="post" action="">
${fields.map(renderField).join('\n')}
<button type="submit">${escapeHtml(buttonLabel)}</button>
</form>`,
	);
}

export function renderRecordedPage(): string {
	return page('Response recorded', heading('Got it, thanks', 'This page can be closed now.'));
}

export type FormResponse =
	| { ok: true; data: Record<string, string | number | boolean> }
	| { ok: false; invalid: string[] };

/** Turns the posted form into answers keyed by field label. */
export function parseFormResponse(
	fields: ResponseField[],
	body: Record<string, unknown>,
): FormResponse {
	const data: Record<string, string | number | boolean> = {};
	const invalid: string[] = [];

	fields.forEach((field, index) => {
		const raw = body[`field-${index}`];
		if (field.fieldType === 'checkbox') {
			data[field.fieldLabel] = raw !== undefined && raw !== '';
			return;
		}

		const value = typeof raw === 'string' ? raw.trim() : '';
		const notAnOption =
			field.fieldType === 'dropdown' && value !== '' && !(field.fieldOptions ?? []).includes(value);
		const notANumber = field.fieldType === 'number' && value !== '' && isNaN(Number(value));
		if (notAnOption || notANumber || (field.requiredField && value === '')) {
			invalid.push(field.fieldLabel);
			return;
		}
		if (value === '') return;
		data[field.fieldLabel] = field.fieldType === 'number' ? Number(value) : value;
	});

	return invalid.length ? { ok: false, invalid } : { ok: true, data };
}

// Link previewers and crawlers that open links before a person does. Inlined instead of `isbot`.
const BOT_USER_AGENT =
	/bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|embedly|linkexpanding|headless/i;

export function isLinkPreviewBot(userAgent: string | undefined): boolean {
	return !userAgent || BOT_USER_AGENT.test(userAgent);
}
