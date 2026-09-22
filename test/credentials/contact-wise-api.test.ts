import { describe, expect, it } from 'vitest';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { CW_BASE_URL, interceptSend, sendPath, sendScenarios } from '../fixtures/contactwise-api';
import { ProbeNode } from '../harness/probe-node';
import { runNode } from '../harness/run-node';

describe('ContactWise API credential', () => {
	it('authenticates requests with the API Key in the X-CW-Api-Key header', async () => {
		const { requests } = interceptSend(sendScenarios.accepted());

		await runNode({
			node: new ProbeNode('contactWiseApi'),
			credentialTypes: [new ContactWiseApi()],
			credentials: {
				contactWiseApi: {
					apiKey: 'cw-key-123',
					tenantId: 'tenant-under-test',
					defaultEntityId: '',
				},
			},
			parameters: { url: `${CW_BASE_URL}${sendPath()}`, value: 'hello', fullResponse: true },
		});

		expect(requests).toHaveLength(1);
		expect(requests[0].headers['x-cw-api-key']).toBe('cw-key-123');
	});
});
