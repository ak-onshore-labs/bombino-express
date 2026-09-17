import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getCustomerStatusLabel,
  getOrderStatusLabel,
  getOrderStatusTone,
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
