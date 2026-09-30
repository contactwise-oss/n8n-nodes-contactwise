import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

function isObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The 'Message Status Updates' selection. 'all' anywhere in `selected` means every status. An
 * empty selection means every status in Trigger v1, and none from v1.1 (TIN-60).
 */
export interface MessageStatusFilter {
	selected: string[];
	emptyMeans: 'all' | 'none';
}

function passesEveryStatus({ selected, emptyMeans }: MessageStatusFilter): boolean {
	return selected.includes('all') || (selected.length === 0 && emptyMeans === 'all');
}

/**
 * Applies the 'Message Status Updates' selection to one change. Only `statuses` are filtered:
 * inbound messages and other fields always pass. Returns undefined when nothing is left.
 */
function filterStatuses(value: IDataObject, filter: MessageStatusFilter): IDataObject | undefined {
	if (passesEveryStatus(filter) || !Array.isArray(value.statuses)) return value;
	const { selected } = filter;
	const statuses = (value.statuses as unknown[]).filter(
		(status) => isObject(status) && selected.includes(String(status.status)),
	);
	if (statuses.length > 0) return { ...value, statuses };
	// A change can in principle carry messages next to statuses; keep those.
	if (Array.isArray(value.messages) && value.messages.length > 0) {
		const rest = { ...value };
		delete rest.statuses;
		return rest;
	}
	return undefined;
}

/** The parsed `response_json` of a submitted Flow, or undefined if it isn't a JSON object. */
function parseFlowResponse(nfmReply: IDataObject): IDataObject | undefined {
	if (typeof nfmReply.response_json !== 'string') return undefined;
	try {
		const parsed: unknown = JSON.parse(nfmReply.response_json);
		return isObject(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function withFlowResponse(message: unknown): unknown {
	if (!isObject(message) || !isObject(message.interactive)) return message;
	const { interactive } = message;
	if (interactive.type !== 'nfm_reply' || !isObject(interactive.nfm_reply)) return message;
	const response = parseFlowResponse(interactive.nfm_reply);
	if (!response) return message;
	return {
		...message,
		interactive: { ...interactive, nfm_reply: { ...interactive.nfm_reply, response } },
	};
}

/**
 * Adds `interactive.nfm_reply.response` (the parsed `response_json`) to each submitted Flow
 * message in an item (Trigger v1.2, TIN-66). `response_json` stays, so expressions written for Meta's shape
 * still work. A `response_json` that isn't a JSON object leaves the message unchanged.
 */
export function withFlowResponses(item: INodeExecutionData): INodeExecutionData {
	if (!Array.isArray(item.json.messages)) return item;
	return {
		...item,
		json: { ...item.json, messages: (item.json.messages as unknown[]).map(withFlowResponse) },
	} as INodeExecutionData;
}

/**
 * Turns one ContactWise delivery (Meta's envelope, filtered to the subscription) into one item
 * per `entry[].changes[]`: the change's `value`, plus its `field`, the WhatsApp Business Account
 * ID and the delivery ID. The shape isn't closed, so unknown properties pass through.
 */
export function deliveryToItems(
	body: unknown,
	deliveryId: string | undefined,
	messageStatuses: MessageStatusFilter,
): INodeExecutionData[] {
	if (!isObject(body) || body.object !== 'whatsapp_business_account') return [];
	if (!Array.isArray(body.entry)) return [];

	const items: INodeExecutionData[] = [];
	for (const entry of body.entry as unknown[]) {
		if (!isObject(entry) || !Array.isArray(entry.changes)) continue;
		for (const change of entry.changes as unknown[]) {
			if (!isObject(change) || !isObject(change.value)) continue;
			const value = filterStatuses(change.value, messageStatuses);
			if (!value) continue;
			items.push({
				json: {
					...value,
					field: change.field,
					whatsAppBusinessAccountId: entry.id,
					deliveryId,
				} as IDataObject,
			});
		}
	}
	return items;
}
