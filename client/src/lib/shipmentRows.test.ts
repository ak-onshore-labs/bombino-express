import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatShipmentAmount,
  orderToRow,
  shipmentToRow,
  type OrderApiRow,
} from './shipmentRows.js';
import type { ShipmentHistoryItem } from './shipmentApiTypes.js';

function order(patch: Partial<OrderApiRow> = {}): OrderApiRow {
  return {
    id: 'o1',
    order_no: 'BOM0001',
    status: 'pickup_requested',
    consignee: { name: 'Asha Rao', city: 'Dallas', country_name: 'United States' },
    items: { api_service_code: 'SPX' },
    quoted_amount: 1200,
    final_amount: null,
    awb_no: null,
    created_at: '2026-09-15T04:00:00Z',
    updated_at: '2026-09-15T04:00:00Z',
    ...patch,
  };
}

function shipment(patch: Partial<ShipmentHistoryItem> = {}): ShipmentHistoryItem {
  return {
    awb_number: 'AWB100',
    consignee_name: 'Asha Rao',
    consignee_city: 'Dallas',
    consignee_country: 'United States',
    service_name: 'Express',
    total_amount: 1200,
    currency: 'INR',
    current_status: 'In Transit',
    booking_date: '2026-09-15',
    created_at: '2026-09-15T04:00:00Z',
    updated_at: '2026-09-16T04:00:00Z',
    ...patch,
  } as ShipmentHistoryItem;
}

test('money is rupees unless the row says otherwise', () => {
  assert.equal(formatShipmentAmount(1705.1, 'INR'), '₹1,705.1');
  assert.equal(formatShipmentAmount('1200', null), '₹1,200');
  assert.equal(formatShipmentAmount(50, 'USD'), 'USD 50');
});

test('an amount that is not a number renders as nothing, not as NaN', () => {
  assert.equal(formatShipmentAmount(null, 'INR'), null);
  assert.equal(formatShipmentAmount('not money', 'INR'), null);
});

test('what a customer pays Bombino is always in rupees', () => {
  // The customs currency of the goods must never price the freight: passing it
  // through rendered ₹1,705.10 as "QAR 1,705".
  const row = orderToRow(order({ items: { api_service_code: 'SPX', free_form_currency: 'QAR' }, quoted_amount: 1705.1 }));
  assert.equal(row.amountStr, '₹1,705.1');
});

test('the final amount replaces the quote once the hub has weighed it', () => {
  assert.equal(orderToRow(order({ quoted_amount: 1200, final_amount: 1450 })).amountStr, '₹1,450');
  assert.equal(orderToRow(order({ quoted_amount: 1200, final_amount: null })).amountStr, '₹1,200');
});

test('an order reads in customer words, never the internal ones', () => {
  const weighed = orderToRow(order({ status: 'weighed' }));
  const settled = orderToRow(order({ status: 'settled' }));
  assert.equal(weighed.statusLabel, settled.statusLabel);
  assert.notEqual(weighed.statusLabel.toLowerCase(), 'weighed');
});

test('a row is live until its journey ends', () => {
  assert.equal(orderToRow(order({ status: 'out_for_pickup' })).isLive, true);
  assert.equal(orderToRow(order({ status: 'dispatched' })).isLive, false);
  assert.equal(orderToRow(order({ status: 'cancelled' })).isLive, false);
});

test('an order carries its AWB when one was filed at booking, and stays an order', () => {
  const docketed = orderToRow(order({ awb_no: 'AWB100' }));
  assert.equal(docketed.isOrder, true);
  assert.equal(docketed.displayId, 'BOM0001');
  assert.equal(docketed.awb, 'AWB100');
});

test('a nameless consignee still reads as something', () => {
  assert.equal(orderToRow(order({ consignee: null })).recipient, 'Unnamed recipient');
  assert.equal(shipmentToRow(shipment({ consignee_name: '   ' })).recipient, 'Unnamed recipient');
});

test('a shipment with no status reads Unknown rather than blank', () => {
  const row = shipmentToRow(shipment({ current_status: '' }));
  assert.equal(row.statusLabel, 'Unknown');
  assert.equal(row.statusTone, 'gray');
  // Nothing has said it is finished, so it keeps polling.
  assert.equal(row.isLive, true);
});

test('a shipment from an older server without updated_at sorts by when it was booked', () => {
  const row = shipmentToRow(shipment({ updated_at: undefined }));
  assert.equal(row.updatedAt, row.createdAt);
});

test('a shipment row is keyed apart from an order row for the same parcel', () => {
  assert.notEqual(shipmentToRow(shipment()).key, orderToRow(order({ awb_no: 'AWB100' })).key);
});
