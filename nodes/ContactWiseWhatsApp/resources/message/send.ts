import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { postMessage, resolveSender, uploadBinaryMedia } from './common';
import { contactContent, contactDescription } from './contact';

const showForSend = { show: { resource: ['message'], operation: ['send'] } };
const showForType = (types: string[]) => ({
	show: { ...showForSend.show, messageType: types },
});

const MEDIA_TYPES = ['image', 'video', 'document', 'audio'];
/** Meta supports captions on these media types only; audio never takes one. */
const CAPTIONED_TYPES = ['image', 'video', 'document'];

export const sendDescription: INodeProperties[] = [
	{
		displayName: 'Message Type',
		name: 'messageType',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Audio', value: 'audio' },
			{ name: 'Contact', value: 'contacts', description: 'A contact card' },
			{ name: 'Document', value: 'document' },
			{ name: 'Image', value: 'image' },
			{ name: 'Location', value: 'location' },
			{ name: 'Text', value: 'text' },
			{ name: 'Video', value: 'video' },
		],
		default: 'text',
		displayOptions: showForSend,
	},
	{
		displayName: 'Text',
		name: 'textBody',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'The message text, up to 4096 characters',
		displayOptions: showForType(['text']),
	},
	{
		displayName: 'Media Source',
		name: 'mediaSource',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Link',
				value: 'link',
				description: 'A public HTTPS URL WhatsApp downloads the file from',
			},
			{
				name: 'Media ID',
				value: 'id',
				description: 'The ID of media already uploaded to WhatsApp',
			},
			{
				name: 'Binary File',
				value: 'binary',
				description: "A file from the item's binary data, uploaded to WhatsApp first",
			},
		],
		default: 'link',
		displayOptions: showForType(MEDIA_TYPES),
	},
	{
		displayName: 'Link',
		name: 'mediaLink',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/image.jpg',
		displayOptions: { show: { ...showForType(MEDIA_TYPES).show, mediaSource: ['link'] } },
	},
	{
		displayName: 'Media ID',
		name: 'mediaId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 1000000000000004',
		displayOptions: { show: { ...showForType(MEDIA_TYPES).show, mediaSource: ['id'] } },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field containing the file to send',
		displayOptions: { show: { ...showForType(MEDIA_TYPES).show, mediaSource: ['binary'] } },
	},
	{
		displayName: 'Latitude',
		name: 'latitude',
		type: 'number',
		required: true,
		default: 0,
		typeOptions: { minValue: -90, maxValue: 90, numberPrecision: 6 },
		displayOptions: showForType(['location']),
	},
	{
		displayName: 'Longitude',
		name: 'longitude',
		type: 'number',
		required: true,
		default: 0,
		typeOptions: { minValue: -180, maxValue: 180, numberPrecision: 6 },
		displayOptions: showForType(['location']),
	},
	...contactDescription(showForType(['contacts'])),
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		options: [
			{
				displayName: 'Caption',
				name: 'mediaCaption',
				type: 'string',
				default: '',
				description: 'Text shown under the media',
				displayOptions: { show: { '/messageType': CAPTIONED_TYPES } },
			},
			{
				displayName: 'Filename',
				name: 'mediaFilename',
				type: 'string',
				default: '',
				placeholder: 'e.g. invoice.pdf',
				description: 'The filename the recipient sees',
				displayOptions: { show: { '/messageType': ['document'] } },
			},
			{
				displayName: 'Location Address',
				name: 'locationAddress',
				type: 'string',
				default: '',
				placeholder: 'e.g. London SW1A 0AA',
				displayOptions: { show: { '/messageType': ['location'] } },
			},
			{
				displayName: 'Location Name',
				name: 'locationName',
				type: 'string',
				default: '',
				placeholder: 'e.g. Big Ben',
				displayOptions: { show: { '/messageType': ['location'] } },
			},
			{
				displayName: 'Show URL Preview',
				name: 'previewUrl',
				type: 'boolean',
				default: false,
				description: 'Whether to show a preview of the first link in the text',
				displayOptions: { show: { '/messageType': ['text'] } },
			},
		],
		displayOptions: showForType(['text', 'location', ...CAPTIONED_TYPES]),
	},
];

interface AdditionalFields {
	previewUrl?: boolean;
	mediaCaption?: string;
	mediaFilename?: string;
	locationName?: string;
	locationAddress?: string;
}

/** The type-specific object Meta expects under the message's `type` key. */
async function messageContent(
	this: IExecuteFunctions,
	messageType: string,
	itemIndex: number,
	additionalFields: AdditionalFields,
	upload: () => Promise<string>,
): Promise<IDataObject | IDataObject[]> {
	if (messageType === 'contacts') return contactContent.call(this, itemIndex);
	if (messageType === 'location') {
		const location: IDataObject = {
			latitude: this.getNodeParameter('latitude', itemIndex) as number,
			longitude: this.getNodeParameter('longitude', itemIndex) as number,
		};
		if (additionalFields.locationName) location.name = additionalFields.locationName;
		if (additionalFields.locationAddress) location.address = additionalFields.locationAddress;
		return location;
	}
	if (messageType === 'text') {
		return {
			body: this.getNodeParameter('textBody', itemIndex) as string,
			preview_url: additionalFields.previewUrl ?? false,
		};
	}

	const source = this.getNodeParameter('mediaSource', itemIndex) as string;
	const content: IDataObject =
		source === 'binary'
			? { id: await upload() }
			: source === 'id'
				? { id: this.getNodeParameter('mediaId', itemIndex) as string }
				: { link: this.getNodeParameter('mediaLink', itemIndex) as string };
	if (CAPTIONED_TYPES.includes(messageType) && additionalFields.mediaCaption) {
		content.caption = additionalFields.mediaCaption;
	}
	if (messageType === 'document' && additionalFields.mediaFilename) {
		content.filename = additionalFields.mediaFilename;
	}
	return content;
}

/** Sends one WhatsApp message for the item at `itemIndex` and returns Meta's response. */
export async function send(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const sender = await resolveSender.call(this, itemIndex);
	const messageType = this.getNodeParameter('messageType', itemIndex) as string;
	const additionalFields = this.getNodeParameter(
		'additionalFields',
		itemIndex,
		{},
	) as AdditionalFields;

	const content = await messageContent.call(this, messageType, itemIndex, additionalFields, () =>
		uploadBinaryMedia.call(this, itemIndex, sender.tenantId, sender.phoneNumberId),
	);
	return await postMessage.call(this, sender, messageType, content, itemIndex);
}
