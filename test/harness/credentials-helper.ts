import { Credentials } from 'n8n-core';
import { ICredentialsHelper } from 'n8n-workflow';
import type {
	ICredentialDataDecryptedObject,
	ICredentialType,
	IDataObject,
	IHttpRequestOptions,
	INodeCredentialsDetails,
	IRequestOptionsSimplified,
} from 'n8n-workflow';

const CREDENTIAL_EXPRESSION = /\{\{\s*\$credentials\??\.([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Resolves the `={{$credentials.x}}` expressions used by generic `authenticate` blocks.
 * Anything more complex fails loudly instead of silently passing a wrong value to the API mock.
 */
function resolveCredentialExpression(value: unknown, credentials: ICredentialDataDecryptedObject) {
	if (typeof value !== 'string' || !value.startsWith('=')) return value;
	const resolved = value.slice(1).replace(CREDENTIAL_EXPRESSION, (_match, key: string) => {
		return String(credentials[key] ?? '');
	});
	if (resolved.includes('{{')) {
		throw new Error(`Test harness can't resolve credential expression: ${value}`);
	}
	return resolved;
}

function resolveAll(values: IDataObject, credentials: ICredentialDataDecryptedObject): IDataObject {
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [key, resolveCredentialExpression(value, credentials)]),
	) as IDataObject;
}

/**
 * Minimal stand-in for n8n's server-side CredentialsHelper: serves decrypted credentials from
 * memory and applies each credential type's `authenticate` (function or generic) to requests.
 */
export class TestCredentialsHelper extends ICredentialsHelper {
	constructor(
		private readonly credentialTypes: Map<string, ICredentialType>,
		private readonly credentialData: Record<string, ICredentialDataDecryptedObject>,
	) {
		super();
	}

	getParentTypes(): string[] {
		return [];
	}

	isCredentialUsableByNode(): boolean {
		return true;
	}

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		typeName: string,
		requestOptions: IHttpRequestOptions | IRequestOptionsSimplified,
	): Promise<IHttpRequestOptions> {
		const options = requestOptions as IHttpRequestOptions;
		const authenticate = this.credentialTypes.get(typeName)?.authenticate;
		if (!authenticate) return options;
		if (typeof authenticate === 'function') return await authenticate(credentials, options);

		const { headers, qs, body, auth } = authenticate.properties;
		return {
			...options,
			...(headers && { headers: { ...options.headers, ...resolveAll(headers, credentials) } }),
			...(qs && { qs: { ...options.qs, ...resolveAll(qs, credentials) } }),
			...(body && { body: { ...(options.body as IDataObject), ...resolveAll(body, credentials) } }),
			...(auth && { auth: resolveAll(auth, credentials) as IHttpRequestOptions['auth'] }),
		};
	}

	async preAuthentication(): Promise<ICredentialDataDecryptedObject | undefined> {
		return undefined;
	}

	async runPreAuthentication(): Promise<ICredentialDataDecryptedObject | undefined> {
		return undefined;
	}

	async getCredentials(nodeCredentials: INodeCredentialsDetails, type: string) {
		return new Credentials({ id: nodeCredentials.id, name: nodeCredentials.name }, type);
	}

	async getDecrypted(
		_additionalData: unknown,
		_nodeCredentials: INodeCredentialsDetails,
		type: string,
	): Promise<ICredentialDataDecryptedObject> {
		const data = this.credentialData[type];
		if (!data) throw new Error(`Test harness has no credentials of type "${type}"`);
		return data;
	}

	async updateCredentials(): Promise<void> {}

	async updateCredentialsOauthTokenData(): Promise<void> {}

	getCredentialsProperties(type: string) {
		return this.credentialTypes.get(type)?.properties ?? [];
	}
}
