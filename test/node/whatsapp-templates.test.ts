import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { ContactWiseWhatsApp } from '../../nodes/ContactWiseWhatsApp/ContactWiseWhatsApp.node';
import { TEST_API_KEY, TEST_TENANT_ID } from '../fixtures/contactwise-api';
import { TEST_WABA_ID, interceptGateway, whatsAppScenarios } from '../fixtures/whatsapp-api';
import { runListSearch } from '../harness/run-list-search';

// Seam L3. From docs/contactwise-whatsapp-api.md: GET /{waba-id}/message_templates?status=APPROVED,
// paged by `paging.cursors.after` until there's no `next`. Label `name (language)`, value `name|language`.
const templatesPath = `${TEST_WABA_ID}/message_templates`;

function listTemplates(paginationToken?: string, credentials: IDataObject = {}) {
	return runListSearch({
		node: new ContactWiseWhatsApp(),
		method: 'getTemplates',
		parameter: 'template',
		paginationToken,
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

describe('ContactWise WhatsApp: Template list', () => {
	it("asks for approved templates only and labels them 'name (language)', valued 'name|language'", async () => {
		const { requests } = interceptGateway(
			'get',
			templatesPath,
			whatsAppScenarios.templates([
				{ name: 'order_update', language: 'en_US' },
				{ name: 'order_update', language: 'hi' },
			]),
		);

		const result = await listTemplates();

		expect(new URL(requests[0].path, 'https://x').searchParams.get('status')).toBe('APPROVED');
		expect(result.results).toEqual([
			{ name: 'order_update (en_US)', value: 'order_update|en_US' },
			{ name: 'order_update (hi)', value: 'order_update|hi' },
		]);
	});

	it('returns a pagination token while Meta has more pages, and passes it back as `after`', async () => {
		interceptGateway(
			'get',
			templatesPath,
			whatsAppScenarios.templates([{ name: 'a', language: 'en' }], 'cursor-2'),
		);
		const first = await listTemplates();
		expect(first.paginationToken).toBe('cursor-2');

		const { requests } = interceptGateway(
			'get',
			templatesPath,
			whatsAppScenarios.templates([{ name: 'b', language: 'en' }]),
		);
		const second = await listTemplates('cursor-2');

		expect(new URL(requests[0].path, 'https://x').searchParams.get('after')).toBe('cursor-2');
		expect(second.results).toEqual([{ name: 'b (en)', value: 'b|en' }]);
		expect(second.paginationToken).toBeUndefined();
	});

	it("without a 'WhatsApp Business Account ID' in the credential: explains what to set, no API call", async () => {
		const { requests } = interceptGateway('get', templatesPath, whatsAppScenarios.templates([]));

		await expect(listTemplates(undefined, { whatsAppBusinessAccountId: '' })).rejects.toThrow(
			/'WhatsApp Business Account ID'/,
		);
		expect(requests).toHaveLength(0);
	});
});
