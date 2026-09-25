import { NodeOperationError, SEND_AND_WAIT_OPERATION } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { normalizeRecipientPhoneNumber } from '../../shared/recipient';
import { contactWiseApiRequest } from '../../../shared/transport';

/** Operations of the Message resource that send a message. */
export const SENDING_OPERATIONS = ['send', 'sendTemplate', SEND_AND_WAIT_OPERATION];

/**
 * 'Phone Number' and 'Recipient Phone Number', shared by every sending operation under the
 * same internal names, so their values survive switching operation.
 */
export const senderAndRecipientDescription: INodeProperties[] = [
	{
		displayName: 'Phone Number',
		name: 'phoneNumberId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'Your WhatsApp number the message is sent from',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'getPhoneNumbers' },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 100000000000002',
			},
		],
		displayOptions: { show: { resource: ['message'], operation: SENDING_OPERATIONS } },
	},
	{
		displayName: 'Recipient Phone Number',
		name: 'recipientPhoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. +447700900123',
		description:
			'International number with country code. Spaces, dashes, dots, brackets and a leading + are allowed.',
		displayOptions: { show: { resource: ['message'], operation: SENDING_OPERATIONS } },
	},
];

export interface Sender {
	tenantId: string;
	phoneNumberId: string;
	/** The recipient as Meta expects it: digits only. */
	to: string;
}

/** Reads and checks the sender and recipient for one item. No API call is made on bad input. */
export async function resolveSender(this: IExecuteFunctions, itemIndex: number): Promise<Sender> {
	const credentials = await this.getCredentials('contactWiseApi', itemIndex);
	const phoneNumberId = this.getNodeParameter('phoneNumberId', itemIndex, '', {
		extractValue: true,
	}) as string;

	const rawRecipient = this.getNodeParameter('recipientPhoneNumber', itemIndex) as string;
	const recipient = normalizeRecipientPhoneNumber(rawRecipient);
	if (!recipient.ok) {
		throw new NodeOperationError(
			this.getNode(),
			`'Recipient Phone Number' isn't a valid international number: '${rawRecipient}' [item ${itemIndex}]`,
			{
				description: 'Include the country code, e.g. +447700900123. The number needs 8–15 digits.',
				itemIndex,
			},
		);
	}

	return { tenantId: credentials.tenantId as string, phoneNumberId, to: recipient.value };
}

/** Posts one message of `type` to `POST /{phone-number-id}/messages` and returns Meta's response. */
export async function postMessage(
	this: IExecuteFunctions,
	sender: Sender,
	type: string,
	content: IDataObject | IDataObject[],
	itemIndex: number,
): Promise<IDataObject> {
	return await contactWiseApiRequest.call(
		this,
		'POST',
		`/v1/waba-direct/${sender.tenantId}/${sender.phoneNumberId}/messages`,
		{
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: sender.to,
			type,
			[type]: content,
		},
		itemIndex,
		'whatsapp',
	);
}
