import { LoadOptionsContext } from 'n8n-core';
import type {
	ICredentialDataDecryptedObject,
	ICredentialType,
	INodeListSearchResult,
	INodeParameters,
	INodeType,
} from 'n8n-workflow';

import { createTestWorkflow } from './run-node';

export interface RunListSearchOptions {
	node: INodeType;
	/** Name of the method under `methods.listSearch`, e.g. `getPhoneNumbers`. */
	method: string;
	/** Parameter the list belongs to, e.g. `phoneNumberId`. */
	parameter: string;
	parameters?: INodeParameters;
	credentialTypes?: ICredentialType[];
	credentials?: Record<string, ICredentialDataDecryptedObject>;
	filter?: string;
	paginationToken?: string;
}

/**
 * Seam L3: runs a node's list-search method inside n8n-core's real `LoadOptionsContext`, the
 * context n8n uses to fill a resource locator's 'From List' mode. HTTP must be faked with nock.
 */
export async function runListSearch(options: RunListSearchOptions): Promise<INodeListSearchResult> {
	const { workflow, node, additionalData } = createTestWorkflow({
		...options,
		parameters: options.parameters ?? {},
	});
	const context = new LoadOptionsContext(
		workflow,
		node,
		additionalData,
		`parameters.${options.parameter}`,
	);

	const method = options.node.methods?.listSearch?.[options.method];
	if (!method) throw new Error(`No listSearch method named ${options.method}`);
	return await method.call(context, options.filter, options.paginationToken);
}
