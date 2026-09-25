import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { ContactWiseWhatsApp } from '../../nodes/ContactWiseWhatsApp/ContactWiseWhatsApp.node';
import { TEST_API_KEY, TEST_TENANT_ID } from '../fixtures/contactwise-api';
import { TEST_WABA_ID, interceptGateway, whatsAppScenarios } from '../fixtures/whatsapp-api';
import { runListSearch } from '../harness/run-list-search';

// Seam L3. Shapes from docs/contactwise-whatsapp-api.md: GET /{waba-id}/phone_numbers, and the
// label `{display_phone_number} - {verified_name}` with the phone number ID as the value.
function listPhoneNumbers(credentials: IDataObject = {}) {
	return runListSearch({
		node: new ContactWiseWhatsApp(),
		method: 'getPhoneNumbers',
		parameter: 'phoneNumberId',
		credentialTypes: [new ContactWiseApi()],
		credentials: {
			contactWiseApi: {
				apiKey: TEST_API_KEY,
				tenantId: TEST_TENANT_ID,
				defaultEntityId: '',
				whatsAppBusinessAccountId: TEST_WABA_ID,
				...credentials,
			},
		},
	});
}

describe('ContactWise WhatsApp: Phone Number list', () => {
	it("lists the account's numbers as '{number} - {verified name}', valued by phone number ID", async () => {
		const { requests } = interceptGateway(
			'get',
			`${TEST_WABA_ID}/phone_numbers`,
			whatsAppScenarios.phoneNumbers([
				{
					id: '100000000000002',
					display_phone_number: '+44 7700 900123',
					verified_name: 'ContactWise Support',
				},
				{
					id: '100000000000003',
					display_phone_number: '+91 98765 43210',
					verified_name: 'ContactWise India',
				},
			]),
		);

		const result = await listPhoneNumbers();

		expect(result.results).toEqual([
			{ name: '+44 7700 900123 - ContactWise Support', value: '100000000000002' },
			{ name: '+91 98765 43210 - ContactWise India', value: '100000000000003' },
		]);
		expect(requests).toHaveLength(1);
		expect(requests[0].headers['x-cw-api-key']).toBe(TEST_API_KEY);
	});

	it("without a 'WhatsApp Business Account ID' in the credential: explains what to set, no API call", async () => {
		const { requests } = interceptGateway(
			'get',
			`${TEST_WABA_ID}/phone_numbers`,
			whatsAppScenarios.phoneNumbers([]),
		);

		await expect(listPhoneNumbers({ whatsAppBusinessAccountId: '' })).rejects.toThrow(
			/'WhatsApp Business Account ID'/,
		);
		expect(requests).toHaveLength(0);
	});

	// Loading a list isn't a send: the wording mustn't say a message was rejected or not sent.
	it('an API rejection says the list could not be loaded, with Meta’s reason and no item number', async () => {
		interceptGateway(
			'get',
			`${TEST_WABA_ID}/phone_numbers`,
			whatsAppScenarios.metaError(100, 'Unsupported get request', {
				details: 'Object does not exist',
			}),
		);

		const failure = listPhoneNumbers();

		await expect(failure).rejects.toThrow(
			"Couldn't load the WhatsApp phone numbers: Unsupported get request",
		);
		await expect(failure).rejects.not.toThrow(/\[item|message|sent/);
	});
});
