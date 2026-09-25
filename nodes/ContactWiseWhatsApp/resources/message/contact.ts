import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

type Show = { show: Record<string, string[]> };

const typeOption = (
	options: Array<{ name: string; value: string }>,
	defaultValue: string,
): INodeProperties => ({
	displayName: 'Type',
	name: 'type',
	type: 'options',
	options,
	default: defaultValue,
});

const HOME = { name: 'Home', value: 'HOME' };
const WORK = { name: 'Work', value: 'WORK' };

/** Parameters for a contact card. `show` limits them to Message Type 'Contacts'. */
export const contactDescription = (show: Show): INodeProperties[] => [
	{
		displayName: 'Formatted Name',
		name: 'contactFormattedName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Asha Rao',
		description:
			"The full name shown on the contact card. Required even if you also set 'First Name' and 'Last Name'.",
		displayOptions: show,
	},
	{
		displayName: 'Contact Fields',
		name: 'contactFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show,
		options: [
			{
				displayName: 'Addresses',
				name: 'addresses',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				options: [
					{
						displayName: 'Address',
						name: 'values',
						values: [
							{ displayName: 'Street', name: 'street', type: 'string', default: '' },
							{ displayName: 'City', name: 'city', type: 'string', default: '' },
							{ displayName: 'State', name: 'state', type: 'string', default: '' },
							{ displayName: 'Postcode', name: 'zip', type: 'string', default: '' },
							{ displayName: 'Country', name: 'country', type: 'string', default: '' },
							{
								displayName: 'Country Code',
								name: 'countryCode',
								type: 'string',
								default: '',
								placeholder: 'e.g. GB',
							},
							typeOption([HOME, WORK], 'HOME'),
						],
					},
				],
			},
			{
				displayName: 'Birthday',
				name: 'birthday',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1990-04-12',
				description: 'Date of birth in YYYY-MM-DD format',
			},
			{
				displayName: 'Emails',
				name: 'emails',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				options: [
					{
						displayName: 'Email',
						name: 'values',
						values: [
							{
								displayName: 'Email',
								name: 'email',
								type: 'string',
								placeholder: 'e.g. name@email.com',
								default: '',
							},
							typeOption([HOME, WORK], 'HOME'),
						],
					},
				],
			},
			{ displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
			{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
			{ displayName: 'Middle Name', name: 'middleName', type: 'string', default: '' },
			{
				displayName: 'Organization',
				name: 'organization',
				type: 'fixedCollection',
				default: {},
				options: [
					{
						displayName: 'Organization',
						name: 'values',
						values: [
							{ displayName: 'Company', name: 'company', type: 'string', default: '' },
							{ displayName: 'Department', name: 'department', type: 'string', default: '' },
							{ displayName: 'Title', name: 'title', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Phones',
				name: 'phones',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				options: [
					{
						displayName: 'Phone',
						name: 'values',
						values: [
							{
								displayName: 'Number',
								name: 'phone',
								type: 'string',
								default: '',
								placeholder: 'e.g. +447700900123',
							},
							typeOption(
								[
									{ name: 'Cell', value: 'CELL' },
									{ name: 'Main', value: 'MAIN' },
									{ name: 'iPhone', value: 'IPHONE' },
									HOME,
									WORK,
								],
								'CELL',
							),
							{
								displayName: 'WhatsApp User ID',
								name: 'waId',
								type: 'string',
								default: '',
								placeholder: 'e.g. 447700900123',
								description:
									"The contact's WhatsApp ID, so the recipient can message them from the card",
							},
						],
					},
				],
			},
			{
				displayName: 'Prefix',
				name: 'prefix',
				type: 'string',
				default: '',
				placeholder: 'e.g. Dr',
			},
			{
				displayName: 'Suffix',
				name: 'suffix',
				type: 'string',
				default: '',
				placeholder: 'e.g. Jr',
			},
			{
				displayName: 'URLs',
				name: 'urls',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				options: [
					{
						displayName: 'URL',
						name: 'values',
						values: [
							{
								displayName: 'URL',
								name: 'url',
								type: 'string',
								default: '',
								placeholder: 'e.g. https://example.com',
							},
							typeOption([HOME, WORK], 'HOME'),
						],
					},
				],
			},
		],
	},
];

interface ContactFields {
	firstName?: string;
	lastName?: string;
	middleName?: string;
	prefix?: string;
	suffix?: string;
	birthday?: string;
	organization?: { values?: IDataObject };
	phones?: { values?: Array<{ phone: string; type: string; waId?: string }> };
	emails?: { values?: IDataObject[] };
	urls?: { values?: IDataObject[] };
	addresses?: { values?: Array<IDataObject & { countryCode?: string }> };
}

/** Drops empty strings so Meta never receives blank fields. */
function compact(object: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(object).filter(([, value]) => value !== undefined && value !== ''),
	);
}

/** Builds Meta's `contacts` array: one contact card per message. */
export function contactContent(this: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const fields = this.getNodeParameter('contactFields', itemIndex, {}) as ContactFields;
	const contact: IDataObject = {
		name: compact({
			formatted_name: this.getNodeParameter('contactFormattedName', itemIndex) as string,
			first_name: fields.firstName,
			last_name: fields.lastName,
			middle_name: fields.middleName,
			prefix: fields.prefix,
			suffix: fields.suffix,
		}),
	};

	if (fields.birthday) contact.birthday = fields.birthday;
	if (fields.organization?.values) contact.org = compact(fields.organization.values);
	if (fields.phones?.values?.length) {
		contact.phones = fields.phones.values.map(({ phone, type, waId }) =>
			compact({ phone, type, wa_id: waId }),
		);
	}
	if (fields.emails?.values?.length) contact.emails = fields.emails.values.map(compact);
	if (fields.urls?.values?.length) contact.urls = fields.urls.values.map(compact);
	if (fields.addresses?.values?.length) {
		contact.addresses = fields.addresses.values.map(({ countryCode, ...address }) =>
			compact({ ...address, country_code: countryCode }),
		);
	}

	return [contact];
}
