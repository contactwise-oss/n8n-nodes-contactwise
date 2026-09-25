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
		// Also the number a media file is uploaded for. Operation values are unique across resources.
		displayOptions: {
			show: { resource: ['message', 'media'], operation: [...SENDING_OPERATIONS, 'upload'] },
		},
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

/** Uploads the item's binary file to WhatsApp and returns the media ID Meta assigns. */
export async function uploadBinaryMedia(
	this: IExecuteFunctions,
	itemIndex: number,
	tenantId: string,
	phoneNumberId: string,
): Promise<string> {
	const propertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const binary = this.helpers.assertBinaryData(itemIndex, propertyName);
	const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, propertyName);

	const form = new FormData();
	form.append('messaging_product', 'whatsapp');
	form.append('type', binary.mimeType);
	form.append(
		'file',
		new Blob([new Uint8Array(buffer)], { type: binary.mimeType }),
		binary.fileName ?? 'file',
	);

	const response = await contactWiseApiRequest.call(
		this,
		'POST',
		`/v1/waba-direct/${tenantId}/${phoneNumberId}/media`,
		form,
		itemIndex,
		// An upload's failure wording names the file, even when it's the first step of a send.
		'whatsapp-upload',
	);
	return response.id as string;
}
