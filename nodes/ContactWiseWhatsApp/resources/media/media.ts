import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { uploadBinaryMedia } from '../message/common';
import { contactWiseApiRequest } from '../../../shared/transport';

export const mediaOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['media'] } },
	options: [
		{
			name: 'Delete',
			value: 'delete',
			description: 'Delete a media file from WhatsApp',
			action: 'Delete media',
		},
		{
			name: 'Upload',
			value: 'upload',
			description: 'Upload a file to WhatsApp and get back a media ID you can use to send it',
			action: 'Upload media',
		},
	],
	default: 'upload',
};

export const mediaDescription: INodeProperties[] = [
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field containing the file to upload',
		displayOptions: { show: { resource: ['media'], operation: ['upload'] } },
	},
	{
		displayName: 'Media ID',
		name: 'mediaId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 1000000000000004',
		description: 'The ID of the media file to delete',
		displayOptions: { show: { resource: ['media'], operation: ['delete'] } },
	},
];

/** Uploads the item's file and returns `{ id }`, the media ID to send it by. */
export async function upload(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const credentials = await this.getCredentials('contactWiseApi', itemIndex);
	const phoneNumberId = this.getNodeParameter('phoneNumberId', itemIndex, '', {
		extractValue: true,
	}) as string;
	const id = await uploadBinaryMedia.call(
		this,
		itemIndex,
		credentials.tenantId as string,
		phoneNumberId,
	);
	return { id };
}

/** Deletes a media file and returns Meta's `{ success }`. */
export async function deleteMedia(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('contactWiseApi', itemIndex);
	const mediaId = (this.getNodeParameter('mediaId', itemIndex) as string).trim();
	return await contactWiseApiRequest.call(
		this,
		'DELETE',
		`/v1/waba-direct/${credentials.tenantId as string}/${encodeURIComponent(mediaId)}`,
		undefined,
		itemIndex,
		'whatsapp-delete',
	);
}
