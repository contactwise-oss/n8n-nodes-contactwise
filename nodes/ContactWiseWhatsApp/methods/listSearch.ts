import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

import type { SendFailure } from '../../shared/errors';
import { FAILURE_CONTEXT_KEY, contactWiseApiRequest } from '../../shared/transport';

interface PhoneNumber {
	id: string;
	display_phone_number: string;
	verified_name: string;
}

interface Template {
	name: string;
	language: string;
}

/**
 * GETs a Graph path under the tenant's WhatsApp Business Account. Each tenant has exactly one
 * account; its ID comes from the credential. `what` names the list in messages, e.g. "phone numbers".
 */
async function getFromAccount(
	this: ILoadOptionsFunctions,
	graphPath: string,
	what: string,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('contactWiseApi');
	const accountId = (credentials.whatsAppBusinessAccountId as string | undefined)?.trim();
	if (!accountId) {
		throw new NodeOperationError(
			this.getNode(),
			"The ContactWise API credential has no 'WhatsApp Business Account ID'",
			{
				description:
					"Add the 'WhatsApp Business Account ID' to the credential, or switch this field to its manual mode. Contact ContactWise support if you don't have the WhatsApp Business Account ID.",
			},
		);
	}

	try {
		return await contactWiseApiRequest.call(
			this,
			'GET',
			`/v1/waba-direct/${credentials.tenantId as string}/${accountId}/${graphPath}`,
			undefined,
			undefined,
			'whatsapp',
		);
	} catch (error) {
		// The shared wording is about sending; loading a list sends nothing.
		const failure =
			error instanceof NodeApiError
				? (error.context[FAILURE_CONTEXT_KEY] as SendFailure | undefined)
				: undefined;
		const reason = failure?.messages[0] ?? failure?.message ?? (error as Error).message;
		throw new NodeOperationError(this.getNode(), `Couldn't load the WhatsApp ${what}: ${reason}`, {
			description:
				"Check the 'WhatsApp Business Account ID', 'API Key' and 'Tenant ID' in the ContactWise API credential.",
		});
	}
}

/** Lists the account's WhatsApp numbers, for the 'Phone Number' resource locator. */
export async function getPhoneNumbers(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
	const response = await getFromAccount.call(this, 'phone_numbers', 'phone numbers');
	const numbers = (response.data ?? []) as PhoneNumber[];
	return {
		results: numbers.map((number) => ({
			name: `${number.display_phone_number} - ${number.verified_name}`,
			value: number.id,
		})),
	};
}

/**
 * Lists the account's approved templates, one page at a time, for the 'Template' resource
 * locator. Meta pages by cursor; n8n asks for the next page with the token returned here.
 */
export async function getTemplates(
	this: ILoadOptionsFunctions,
	_filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const query = new URLSearchParams({ status: 'APPROVED', fields: 'name,language' });
	if (paginationToken) query.set('after', paginationToken);

	const response = await getFromAccount.call(
		this,
		`message_templates?${query.toString()}`,
		'templates',
	);
	const templates = (response.data ?? []) as Template[];
	const paging = response.paging as { next?: string; cursors?: { after?: string } } | undefined;

	return {
		results: templates.map((template) => ({
			name: `${template.name} (${template.language})`,
			value: `${template.name}|${template.language}`,
		})),
		paginationToken: paging?.next ? paging.cursors?.after : undefined,
	};
}
