import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { FAILURE_CONTEXT_KEY, contactWiseApiRequest } from '../shared/transport';
import type { SendFailure } from '../shared/errors';
import { deliveryToItems } from './shared/events';
import { verifyDelivery } from './shared/signature';

/** ContactWise's limit for a subscription's `description` (TIN-34). */
const MAX_DESCRIPTION_LENGTH = 200;

interface Subscription {
	id?: string;
	url?: string;
	fields?: string[];
	status?: string;
}

async function webhooksPath(this: IHookFunctions, subscriptionId?: string): Promise<string> {
	const { tenantId } = await this.getCredentials('contactWiseApi');
	const path = `/v1/whatsapp/${tenantId as string}/webhooks`;
	return subscriptionId ? `${path}/${encodeURIComponent(subscriptionId)}` : path;
}

/** Deletes a subscription. A 404 means it's already gone, which is what we wanted. */
async function deleteSubscription(this: IHookFunctions, subscriptionId: string): Promise<void> {
	const failed: unknown = await contactWiseApiRequest
		.call(
			this,
			'DELETE',
			await webhooksPath.call(this, subscriptionId),
			undefined,
			undefined,
			'whatsapp-webhook-delete',
		)
		.then(
			() => undefined,
			(error: unknown) => error,
		);
	if (failed === undefined) return;
	const failure =
		failed instanceof NodeApiError
			? (failed.context[FAILURE_CONTEXT_KEY] as SendFailure | undefined)
			: undefined;
	if (failure?.httpStatus === 404) return;
	throw failed instanceof NodeApiError
		? failed
		: new NodeApiError(this.getNode(), failed as JsonObject);
}

function forget(staticData: IDataObject): void {
	delete staticData.webhookId;
	delete staticData.webhookSecret;
}

function sameFields(a: string[] = [], b: string[] = []): boolean {
	return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

export class ContactWiseWhatsAppTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ContactWise WhatsApp Trigger',
		name: 'contactWiseWhatsAppTrigger',
		icon: {
			light: 'file:../../icons/contactwise.svg',
			dark: 'file:../../icons/contactwise.dark.svg',
		},
		group: ['trigger'],
		version: [1],
		subtitle:
			'={{"Events: " + $parameter["updates"].map((field) => field.replace(/_/g, " ")).join(", ")}}',
		description:
			'Starts the workflow when a WhatsApp event reaches ContactWise, such as an incoming message or a message status update.',
		defaults: {
			name: 'ContactWise WhatsApp Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'contactWiseApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					"ContactWise sends events to this workflow's webhook URL, so it must be a public https:// address. n8n on localhost or a private network can't receive them.",
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Trigger On',
				name: 'updates',
				type: 'multiOptions',
				required: true,
				default: ['messages'],
				description: 'The WhatsApp events that start the workflow',
				options: [
					{ name: 'Account Review Update', value: 'account_review_update' },
					{ name: 'Account Update', value: 'account_update' },
					{ name: 'Business Capability Update', value: 'business_capability_update' },
					{ name: 'Message Template Quality Update', value: 'message_template_quality_update' },
					{ name: 'Message Template Status Update', value: 'message_template_status_update' },
					{
						name: 'Messages',
						value: 'messages',
						description: 'Incoming messages, and status updates for messages you sent',
					},
					{ name: 'Phone Number Name Update', value: 'phone_number_name_update' },
					{ name: 'Phone Number Quality Update', value: 'phone_number_quality_update' },
					{
						name: 'Security',
						value: 'security',
						description: 'Security changes to the WhatsApp Business Account',
					},
					{ name: 'Template Category Update', value: 'template_category_update' },
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Message Status Updates',
						name: 'messageStatusUpdates',
						type: 'multiOptions',
						default: ['all'],
						description:
							'Which message statuses start the workflow. Incoming messages and other events always do.',
						options: [
							{ name: 'All', value: 'all' },
							{ name: 'Deleted', value: 'deleted' },
							{ name: 'Delivered', value: 'delivered' },
							{ name: 'Failed', value: 'failed' },
							{ name: 'Read', value: 'read' },
							{ name: 'Sent', value: 'sent' },
						],
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			/**
			 * True only when the stored subscription is still listed, active, for this URL and these
			 * events. Anything else is deleted and forgotten, so `create` registers a fresh one:
			 * ContactWise has no route to re-enable a disabled subscription.
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const webhookId = staticData.webhookId as string | undefined;
				if (!webhookId) return false;

				const response = await contactWiseApiRequest.call(
					this,
					'GET',
					await webhooksPath.call(this),
					undefined,
					undefined,
					'whatsapp-webhook-list',
				);
				const subscriptions = Array.isArray(response.data) ? (response.data as Subscription[]) : [];
				const subscription = subscriptions.find(({ id }) => id === webhookId);

				if (
					subscription &&
					subscription.status === 'active' &&
					subscription.url === this.getNodeWebhookUrl('default') &&
					sameFields(subscription.fields, this.getNodeParameter('updates') as string[]) &&
					staticData.webhookSecret
				) {
					return true;
				}

				if (subscription) await deleteSubscription.call(this, webhookId);
				forget(staticData);
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const description = (this.getWorkflow().name ?? '').slice(0, MAX_DESCRIPTION_LENGTH);

				const response = await contactWiseApiRequest.call(
					this,
					'POST',
					await webhooksPath.call(this),
					{
						url: this.getNodeWebhookUrl('default'),
						fields: this.getNodeParameter('updates') as string[],
						...(description && { description }),
					},
					undefined,
					'whatsapp-webhook-create',
				);

				if (typeof response.id !== 'string' || typeof response.secret !== 'string') {
					throw new NodeOperationError(
						this.getNode(),
						"ContactWise's response didn't include the webhook's signing secret",
						{
							description:
								"Without it, n8n can't check that events come from ContactWise. Activate the workflow again.",
						},
					);
				}
				staticData.webhookId = response.id;
				staticData.webhookSecret = response.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const webhookId = staticData.webhookId as string | undefined;
				if (webhookId) {
					try {
						await deleteSubscription.call(this, webhookId);
					} catch (error) {
						// n8n deactivates the workflow anyway. The subscription is kept, so the next
						// activation's checkExists finds and replaces it.
						this.logger.warn(
							`Couldn't remove ContactWise webhook subscription '${webhookId}': ${(error as Error).message}`,
						);
						return false;
					}
				}
				forget(staticData);
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const secret = this.getWorkflowStaticData('node').webhookSecret as string | undefined;

		// The signature covers the bytes ContactWise sent. n8n's parsed body can't be used: it
		// re-serialises emoji differently, so a real signature would fail to verify.
		const rawBody = request.rawBody as Buffer | undefined;
		if (!secret || !Buffer.isBuffer(rawBody) || !verifyDelivery(secret, rawBody, request.headers)) {
			response.status(401).send('Unauthorized');
			return { noWebhookResponse: true };
		}

		const options = this.getNodeParameter('options', {}) as { messageStatusUpdates?: string[] };
		const deliveryId = request.headers['x-cw-delivery-id'];
		const items = deliveryToItems(
			this.getBodyData(),
			typeof deliveryId === 'string' ? deliveryId : undefined,
			options.messageStatusUpdates ?? ['all'],
		);

		if (items.length === 0) {
			response.status(200).end();
			return { noWebhookResponse: true };
		}
		return { workflowData: [items] };
	}
}
