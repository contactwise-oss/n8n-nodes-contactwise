import type { IDataObject, INodeExecutionData, INodeParameters } from 'n8n-workflow';

import { ContactWiseApi } from '../../credentials/ContactWiseApi.credentials';
import { ContactWiseWhatsApp } from '../../nodes/ContactWiseWhatsApp/ContactWiseWhatsApp.node';
import { TEST_API_KEY, TEST_TENANT_ID } from '../fixtures/contactwise-api';
import { TEST_PHONE_NUMBER_ID, TEST_WABA_ID } from '../fixtures/whatsapp-api';
import { runNode } from '../harness/run-node';

/** Runs the ContactWise WhatsApp node at seam L2 with a complete credential. */
export const baseSendParameters = {
	resource: 'message',
	operation: 'send',
	phoneNumberId: { __rl: true, mode: 'id', value: TEST_PHONE_NUMBER_ID },
	recipientPhoneNumber: '+44 7700 900123',
	messageType: 'text',
	textBody: 'Hello from n8n',
	additionalFields: {},
};

export function runWhatsApp(
	overrides: {
		/** Parameters the overrides apply to. Defaults to a text Message → Send. */
		base?: IDataObject;
		parameters?: IDataObject;
		credentials?: IDataObject;
		input?: IDataObject[];
		inputItems?: INodeExecutionData[];
		continueOnFail?: boolean;
	} = {},
) {
	return runNode({
		node: new ContactWiseWhatsApp(),
		credentialTypes: [new ContactWiseApi()],
		credentials: {
			contactWiseApi: {
				apiKey: TEST_API_KEY,
				tenantId: TEST_TENANT_ID,
				defaultEntityId: '',
				whatsAppBusinessAccountId: TEST_WABA_ID,
				...overrides.credentials,
			},
		},
		parameters: {
			...(overrides.base ?? baseSendParameters),
			...overrides.parameters,
		} as INodeParameters,
		input: overrides.input,
		inputItems: overrides.inputItems,
		continueOnFail: overrides.continueOnFail,
	});
}
