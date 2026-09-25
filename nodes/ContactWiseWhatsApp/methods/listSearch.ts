import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

import type { SendFailure } from '../../shared/errors';
import { FAILURE_CONTEXT_KEY, contactWiseApiRequest } from '../../shared/transport';

interface PhoneNumber {
	id: string;
	display_phone_number: string;
	verified_name: string;
}

/**
 * Lists the WhatsApp numbers of the tenant's WhatsApp Business Account, for the 'Phone Number'
 * resource locator. Each tenant has exactly one account; its ID comes from the credential.
 */
export async function getPhoneNumbers(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
	const credentials = await this.getCredentials('contactWiseApi');
	const accountId = (credentials.whatsAppBusinessAccountId as string | undefined)?.trim();
	if (!accountId) {
		throw new NodeOperationError(
			this.getNode(),
			"The ContactWise API credential has no 'WhatsApp Business Account ID'",
			{
				description:
					"Add the 'WhatsApp Business Account ID' to the credential, or switch 'Phone Number' to 'ID' and enter the number's ID. Contact ContactWise support if you don't have the account ID.",
			},
		);
	}

	let response;
	try {
		response = await contactWiseApiRequest.call(
			this,
			'GET',
			`/v1/waba-direct/${credentials.tenantId as string}/${accountId}/phone_numbers`,
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
		throw new NodeOperationError(
			this.getNode(),
			`Couldn't load the WhatsApp phone numbers: ${reason}`,
			{
				description:
					"Check the 'WhatsApp Business Account ID', 'API Key' and 'Tenant ID' in the ContactWise API credential.",
			},
		);
	}

	const numbers = (response.data ?? []) as PhoneNumber[];
	return {
		results: numbers.map((number) => ({
			name: `${number.display_phone_number} - ${number.verified_name}`,
			value: number.id,
		})),
	};
}
