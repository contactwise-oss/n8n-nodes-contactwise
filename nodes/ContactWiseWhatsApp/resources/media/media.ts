import { NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

import { uploadBinaryMedia } from '../message/common';
import { contactWiseApiDownload, contactWiseApiRequest } from '../../../shared/transport';

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
			name: 'Download',
			value: 'download',
			description: 'Download a media file, such as a photo that a customer sent, as binary data',
			action: 'Download media',
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

const WHICH_PHONE_NUMBER =
	'For media a customer sent, use the number that received the message. For media you uploaded, use the number you uploaded it with.';

const PHONE_NUMBER_DESCRIPTION = `Your WhatsApp number the media file belongs to. ${WHICH_PHONE_NUMBER}`;
const showForDeleteAndDownload = { resource: ['media'], operation: ['delete', 'download'] };

export const mediaDescription: INodeProperties[] = [
	// 'Phone Number' for Delete and Download (TIN-68): the number the media file belongs to, sent as
	// `phone_number_id`. Required from v1.4. Optional before, so saved workflows keep running.
	{
		displayName: 'Phone Number',
		name: 'phoneNumberId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: PHONE_NUMBER_DESCRIPTION,
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
		displayOptions: { show: { ...showForDeleteAndDownload, '@version': [{ _cnd: { gte: 1.4 } }] } },
	},
	{
		displayName: 'Phone Number',
		name: 'phoneNumberId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		description: PHONE_NUMBER_DESCRIPTION,
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
		displayOptions: { show: { ...showForDeleteAndDownload, '@version': [{ _cnd: { lt: 1.4 } }] } },
	},
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
		description: 'The ID of the media file, from an upload or from a message that a customer sent',
		displayOptions: { show: { resource: ['media'], operation: ['delete', 'download'] } },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
		displayOptions: { show: { resource: ['media'], operation: ['download'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['media'], operation: ['download'] } },
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g. invoice.pdf',
				description:
					"The name to give the file. By default, it's the 'Media ID' with a file extension based on the file's type.",
			},
		],
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

/**
 * `?phone_number_id=…` for the item's 'Phone Number', so Meta only acts on media that belongs to
 * it (TIN-58). Empty when no number is set, which only versions before 1.4 allow.
 */
function phoneNumberQuery(this: IExecuteFunctions, itemIndex: number): string {
	const phoneNumberId = String(
		this.getNodeParameter('phoneNumberId', itemIndex, '', { extractValue: true }) ?? '',
	).trim();
	if (phoneNumberId) return `?phone_number_id=${encodeURIComponent(phoneNumberId)}`;
	if (this.getNode().typeVersion < 1.4) return '';
	throw new NodeOperationError(this.getNode(), `'Phone Number' is empty [item ${itemIndex}]`, {
		description: `Select the WhatsApp number the media file belongs to, or enter its ID. ${WHICH_PHONE_NUMBER}`,
		itemIndex,
	});
}

/** Deletes a media file and returns Meta's `{ success }`. */
export async function deleteMedia(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('contactWiseApi', itemIndex);
	const mediaId = (this.getNodeParameter('mediaId', itemIndex) as string).trim();
	const query = phoneNumberQuery.call(this, itemIndex);
	return await contactWiseApiRequest.call(
		this,
		'DELETE',
		`/v1/waba-direct/${credentials.tenantId as string}/${encodeURIComponent(mediaId)}${query}`,
		undefined,
		itemIndex,
		'whatsapp-delete',
	);
}

/** `attachment; filename="123.pdf"` → `123.pdf`. */
function fileNameFrom(contentDisposition: unknown): string | undefined {
	if (typeof contentDisposition !== 'string') return undefined;
	return /filename="?([^";]+)"?/i.exec(contentDisposition)?.[1];
}

/**
 * Downloads a media file through the gateway's streaming route (TIN-33) into the item's binary
 * field, and describes it in the JSON.
 */
export async function download(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const credentials = await this.getCredentials('contactWiseApi', itemIndex);
	const mediaId = (this.getNodeParameter('mediaId', itemIndex) as string).trim();
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const options = this.getNodeParameter('options', itemIndex, {}) as { fileName?: string };
	const query = phoneNumberQuery.call(this, itemIndex);

	const { data, headers } = await contactWiseApiDownload.call(
		this,
		`/v1/whatsapp/${credentials.tenantId as string}/media/${encodeURIComponent(mediaId)}/content${query}`,
		itemIndex,
		'whatsapp-download',
	);

	// `audio/ogg; codecs=opus` → `audio/ogg`: the form WhatsApp accepts when the file is sent again.
	const mimeType = String(headers['content-type'] ?? 'application/octet-stream')
		.split(';')[0]
		.trim();
	const fileName = options.fileName?.trim() || fileNameFrom(headers['content-disposition']);
	const binary = await this.helpers.prepareBinaryData(data, fileName, mimeType);

	return {
		json: {
			id: mediaId,
			mimeType,
			fileName: binary.fileName,
			fileSize: data.length,
			sha256: headers['x-cw-media-sha256'],
		},
		binary: { [binaryPropertyName]: binary },
		pairedItem: { item: itemIndex },
	};
}
