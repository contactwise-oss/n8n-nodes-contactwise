import { describe, expect, it } from 'vitest';

import { deliveryToItems } from '../../nodes/ContactWiseWhatsAppTrigger/shared/events';

// Shapes follow the TIN-34 integration contract: Meta's envelope, filtered to the subscription.
const WABA_ID = '100000000000001';
const DELIVERY_ID = 'dlv_8_dZvztsSsZqRAMrlPSZzp';

const metadata = { display_phone_number: '15550001111', phone_number_id: '100000000000002' };

const inboundMessage = {
	field: 'messages',
	value: {
		messaging_product: 'whatsapp',
		metadata,
		contacts: [{ profile: { name: 'Asha' }, wa_id: '447700900123' }],
		messages: [{ from: '447700900123', id: 'wamid.in', type: 'text', text: { body: 'Hi' } }],
	},
};

const statusChange = (status: string, id = `wamid.${status}`) => ({
	field: 'messages',
	value: {
		messaging_product: 'whatsapp',
		metadata,
		statuses: [{ id, status, recipient_id: '447700900123', timestamp: '1790000000' }],
	},
});

const templateStatus = {
	field: 'message_template_status_update',
	value: { event: 'APPROVED', message_template_id: 1234, message_template_name: 'otp' },
};

const envelope = (...entries: Array<{ id?: string; changes: unknown[]; time?: number }>) => ({
	object: 'whatsapp_business_account',
	entry: entries.map((entry) => ({ id: WABA_ID, ...entry })),
});

/** v1's rule: an empty selection means all statuses. */
const v1 = (selected: string[]) => ({ selected, emptyMeans: 'all' as const });
/** v1.1's rule: an empty selection means no statuses. */
const v11 = (selected: string[]) => ({ selected, emptyMeans: 'none' as const });
const ALL = v1(['all']);

describe('deliveryToItems', () => {
	it('emits one item per change, with the change value, its field and the delivery ID', () => {
		const items = deliveryToItems(envelope({ changes: [inboundMessage] }), DELIVERY_ID, ALL);

		expect(items).toEqual([
			{
				json: {
					...inboundMessage.value,
					field: 'messages',
					whatsAppBusinessAccountId: WABA_ID,
					deliveryId: DELIVERY_ID,
				},
			},
		]);
	});

	it('emits three items for a batch of three changes across two entries', () => {
		const items = deliveryToItems(
			envelope(
				{ changes: [inboundMessage, statusChange('delivered')] },
				{ id: '999', changes: [templateStatus] },
			),
			DELIVERY_ID,
			ALL,
		);

		expect(items.map(({ json }) => [json.field, json.whatsAppBusinessAccountId])).toEqual([
			['messages', WABA_ID],
			['messages', WABA_ID],
			['message_template_status_update', '999'],
		]);
		expect(items.every(({ json }) => json.deliveryId === DELIVERY_ID)).toBe(true);
	});

	it('passes unmodelled properties through', () => {
		const change = {
			field: 'messages',
			value: { ...inboundMessage.value, new_meta_thing: { a: 1 } },
		};
		const [item] = deliveryToItems(
			envelope({ changes: [change], time: 1790000000 }),
			DELIVERY_ID,
			ALL,
		);

		expect(item.json.new_meta_thing).toEqual({ a: 1 });
	});

	it('emits nothing for an object other than whatsapp_business_account', () => {
		const body = { ...envelope({ changes: [inboundMessage] }), object: 'page' };

		expect(deliveryToItems(body, DELIVERY_ID, ALL)).toEqual([]);
	});

	it.each([
		['no entry list', { object: 'whatsapp_business_account' }],
		['an empty entry list', { object: 'whatsapp_business_account', entry: [] }],
		['an entry without changes', { object: 'whatsapp_business_account', entry: [{ id: WABA_ID }] }],
		[
			'a change without a value',
			{ object: 'whatsapp_business_account', entry: [{ id: WABA_ID, changes: [{ field: 'x' }] }] },
		],
	])('emits nothing for %s', (_name, body) => {
		expect(deliveryToItems(body, DELIVERY_ID, ALL)).toEqual([]);
	});

	describe('message status filter', () => {
		const body = envelope({
			changes: [
				statusChange('sent'),
				statusChange('delivered'),
				statusChange('read'),
				statusChange('failed'),
				inboundMessage,
				templateStatus,
			],
		});

		const statusesOf = (items: ReturnType<typeof deliveryToItems>) =>
			items.map(({ json }) =>
				Array.isArray(json.statuses)
					? (json.statuses as Array<{ status: string }>).map((s) => s.status).join('+')
					: json.field,
			);

		it("passes every status with 'All'", () => {
			expect(statusesOf(deliveryToItems(body, DELIVERY_ID, v1(['all'])))).toEqual([
				'sent',
				'delivered',
				'read',
				'failed',
				'messages',
				'message_template_status_update',
			]);
		});

		it('passes every status when nothing is selected and empty means all (v1)', () => {
			expect(deliveryToItems(body, DELIVERY_ID, v1([]))).toHaveLength(6);
		});

		it('drops statuses that are not selected and keeps messages and other fields', () => {
			expect(statusesOf(deliveryToItems(body, DELIVERY_ID, v1(['delivered', 'failed'])))).toEqual([
				'delivered',
				'failed',
				'messages',
				'message_template_status_update',
			]);
		});

		it('keeps only the selected statuses of a change that holds several', () => {
			const change = {
				field: 'messages',
				value: {
					metadata,
					statuses: [
						{ id: 'a', status: 'sent' },
						{ id: 'b', status: 'read' },
					],
				},
			};
			const items = deliveryToItems(envelope({ changes: [change] }), DELIVERY_ID, v1(['read']));

			expect(items).toHaveLength(1);
			expect(items[0].json.statuses).toEqual([{ id: 'b', status: 'read' }]);
		});

		it('keeps the messages of a change whose statuses are all filtered out', () => {
			const change = {
				field: 'messages',
				value: { ...inboundMessage.value, statuses: [{ id: 'a', status: 'sent' }] },
			};
			const items = deliveryToItems(envelope({ changes: [change] }), DELIVERY_ID, v1(['read']));

			expect(items).toHaveLength(1);
			expect(items[0].json.messages).toEqual(inboundMessage.value.messages);
			expect(items[0].json).not.toHaveProperty('statuses');
		});

		it('returns nothing when every status is filtered out', () => {
			const items = deliveryToItems(
				envelope({ changes: [statusChange('sent'), statusChange('read')] }),
				DELIVERY_ID,
				v1(['failed']),
			);

			expect(items).toEqual([]);
		});

		describe('when empty means none (v1.1)', () => {
			it('drops every status and keeps incoming messages and other fields', () => {
				expect(statusesOf(deliveryToItems(body, DELIVERY_ID, v11([])))).toEqual([
					'messages',
					'message_template_status_update',
				]);
			});

			it('keeps the messages of a change that also holds statuses', () => {
				const change = {
					field: 'messages',
					value: { ...inboundMessage.value, statuses: [{ id: 'a', status: 'sent' }] },
				};
				const items = deliveryToItems(envelope({ changes: [change] }), DELIVERY_ID, v11([]));

				expect(items).toHaveLength(1);
				expect(items[0].json.messages).toEqual(inboundMessage.value.messages);
				expect(items[0].json).not.toHaveProperty('statuses');
			});

			it('returns nothing for a delivery of statuses only', () => {
				const items = deliveryToItems(
					envelope({ changes: [statusChange('sent'), statusChange('delivered')] }),
					DELIVERY_ID,
					v11([]),
				);

				expect(items).toEqual([]);
			});

			it('passes only the selected statuses', () => {
				expect(statusesOf(deliveryToItems(body, DELIVERY_ID, v11(['failed'])))).toEqual([
					'failed',
					'messages',
					'message_template_status_update',
				]);
			});

			it("passes every status with 'All' next to other options", () => {
				expect(statusesOf(deliveryToItems(body, DELIVERY_ID, v11(['read', 'all'])))).toEqual([
					'sent',
					'delivered',
					'read',
					'failed',
					'messages',
					'message_template_status_update',
				]);
			});
		});
	});
});
