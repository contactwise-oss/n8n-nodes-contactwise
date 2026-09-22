import type { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';

import { version } from '../../../package.json';

export const CONTACTWISE_BASE_URL = 'https://api.contactwise.io';

/** Lets ContactWise count traffic that comes from n8n (TIN-6). */
export const SOURCE_HEADER = { 'X-CW-Source': `n8n-nodes-contactwise/${version}` };

export async function contactWiseApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	body: IDataObject,
): Promise<IDataObject> {
	return (await this.helpers.httpRequestWithAuthentication.call(this, 'contactWiseApi', {
		method,
		url: `${CONTACTWISE_BASE_URL}${path}`,
		body,
		json: true,
		headers: SOURCE_HEADER,
	})) as IDataObject;
}
