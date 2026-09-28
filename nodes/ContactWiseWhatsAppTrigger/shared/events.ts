import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

function isObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Applies the 'Message Status Updates' option to one change. Only `statuses` are filtered:
 * inbound messages and other fields always pass. Returns undefined when nothing is left.
 */
function filterStatuses(value: IDataObject, selected: string[]): IDataObject | undefined {
	if (selected.length === 0 || selected.includes('all') || !Array.isArray(value.statuses)) {
		return value;
	}
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

/**
 * Turns one ContactWise delivery (Meta's envelope, filtered to the subscription) into one item
 * per `entry[].changes[]`: the change's `value`, plus its `field`, the WhatsApp Business Account
 * ID and the delivery ID. The shape isn't closed, so unknown properties pass through.
 */
export function deliveryToItems(
	body: unknown,
	deliveryId: string | undefined,
	messageStatuses: string[],
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
