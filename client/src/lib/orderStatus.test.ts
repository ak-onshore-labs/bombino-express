import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getCustomerStatusLabel,
  getOrderStatusLabel,
  getOrderStatusTone,
  orderStillMoving,
} from './orderStatus.js';
import { ORDER_STATUSES } from '@shared/orderContract';

/** What ops reads and the customer must never see. */
const INTERNAL_ONLY = ['weighed', 'settled', 'ready_for_docket'] as const;

test('every status in the contract has an ops label and a tone', () => {
  for (const status of ORDER_STATUSES) {
    const label = getOrderStatusLabel(status);
    assert.notEqual(label, status, `${status} fell through to its raw value`);
    assert.ok(getOrderStatusTone(status));
  }
});

test('the hub phase sits still for the customer', () => {
  const labels = INTERNAL_ONLY.map(getCustomerStatusLabel);
  assert.equal(new Set(labels).size, 1, 'the three hub steps leaked apart');
  assert.ok(labels[0].length > 0);
});

test('an internal label never reaches a customer screen', () => {
  for (const status of INTERNAL_ONLY) {
    assert.notEqual(getCustomerStatusLabel(status), getOrderStatusLabel(status));
  }
});

test('the ends of the journey read the same to both', () => {
  assert.equal(getOrderStatusTone('dispatched'), 'green');
  assert.equal(getOrderStatusTone('cancelled'), 'red');
});

test('a status nobody knows degrades rather than throwing', () => {
  assert.equal(getOrderStatusLabel('invented_by_itd'), 'invented_by_itd');
  assert.equal(getOrderStatusTone('invented_by_itd'), 'gray');
});

test('ITD wins once it has the parcel (BOM-100347: delivered, ours still at hub)', async () => {
  const { customerOrderStatus } = await import('./orderStatus.js');
  const view = customerOrderStatus('received_at_hub', { state: 'delivered', at: '2026-11-15T17:53:43Z' });
  assert.equal(view.label, 'Delivered');
  assert.equal(view.tone, 'green');
  assert.equal(view.shipped, true);
  assert.equal(view.final, true);
});

test('ITD booking entry alone does not move the order', async () => {
  const { customerOrderStatus } = await import('./orderStatus.js');
  const view = customerOrderStatus('awaiting_dropoff', { state: 'entry', at: '2026-11-13T01:41:41Z' });
  assert.equal(view.label, getCustomerStatusLabel('awaiting_dropoff'));
  assert.equal(view.shipped, false);
  assert.equal(view.final, false);
});

test('no ITD scan yet: our own status', async () => {
  const { customerOrderStatus } = await import('./orderStatus.js');
  assert.equal(customerOrderStatus('picked_up', null).label, getCustomerStatusLabel('picked_up'));
  assert.equal(customerOrderStatus('dispatched', undefined).shipped, true);
});

test('a cancelled order stays cancelled whatever ITD says', async () => {
  const { customerOrderStatus } = await import('./orderStatus.js');
  const view = customerOrderStatus('cancelled', { state: 'INTRANSIT', at: '' });
  assert.equal(view.label, getCustomerStatusLabel('cancelled'));
  assert.equal(view.shipped, false);
});

test('dispatched orders show ITD progress instead of a fixed "In transit"', async () => {
  const { customerOrderStatus } = await import('./orderStatus.js');
  assert.equal(customerOrderStatus('dispatched', { state: 'DRS', at: '' }).label, 'Out for Delivery');
});

test('an order keeps moving until ITD gives its last word', () => {
  const at = '2026-11-17T10:00:00Z';
  assert.equal(orderStillMoving('received_at_hub', null), true);
  assert.equal(orderStillMoving('dispatched', null), true);
  assert.equal(orderStillMoving('dispatched', { state: 'INTRANSIT', at }), true);
  assert.equal(orderStillMoving('dispatched', { state: 'DELIVERED', at }), false);
  assert.equal(orderStillMoving('received_at_hub', { state: 'DELIVERED', at }), false);
  assert.equal(orderStillMoving('cancelled', null), false);
  assert.equal(orderStillMoving('cancelled', { state: 'INTRANSIT', at }), false);
});
