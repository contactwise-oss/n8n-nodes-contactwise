import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ContactWiseApi implements ICredentialType {
	name = 'contactWiseApi';

	displayName = 'ContactWise API';

	icon: Icon = {
		light: 'file:../icons/contactwise.svg',
		dark: 'file:../icons/contactwise.dark.svg',
	};

	documentationUrl =
		'https://github.com/contactwise-oss/n8n-nodes-contactwise?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: "Your ContactWise API key. Contact ContactWise support if you don't have one.",
		},
		{
			displayName: 'Tenant ID',
			name: 'tenantId',
			type: 'string',
			required: true,
			default: '',
			description: "Your ContactWise tenant ID. Contact ContactWise support if you don't have one.",
		},
		{
			displayName: 'Default Entity ID',
			name: 'defaultEntityId',
			type: 'string',
			default: '',
			placeholder: 'e.g. 1201159143227331234',
			description:
				"DLT principal entity ID (PE ID) used when a node's 'DLT Entity ID' is empty. Leave empty to set it on each node.",
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-CW-Api-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.contactwise.io',
			url: '=/v1/account/{{$credentials.tenantId}}/me',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message: "The 'API Key' is invalid, or it doesn't belong to this tenant",
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 404,
					message:
						"This tenant isn't active. Check the 'Tenant ID' or contact ContactWise support.",
				},
			},
		],
	};
}
