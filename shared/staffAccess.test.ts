import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OPS_ROLES,
  OPS_TABS_BY_ROLE,
  assignableRoles,
  can,
  canSeeTab,
  isCityScoped,
} from './staffAccess.js';
import { roleSatisfies } from './orderContract.js';

test('tabs match the Proposed Roles sheet', () => {
  assert.deepEqual(OPS_TABS_BY_ROLE.branch_manager, [
    'dashboard', 'pickups', 'dropoffs', 'dispatched', 'users', 'beats', 'pincodes',
  ]);
  assert.deepEqual(OPS_TABS_BY_ROLE.accounts, ['dashboard', 'transactions', 'dispatched', 'customers']);
  assert.deepEqual(OPS_TABS_BY_ROLE.kyc_reviewer, ['applications', 'customers', 'guests']);
  assert.equal(canSeeTab('admin', 'settings'), false);
  assert.equal(canSeeTab('super_admin', 'settings'), true);
  assert.equal(canSeeTab('agent', 'dashboard'), false);
  assert.equal(canSeeTab('customer', 'dashboard'), false);
});

test('every tab a role sees has the permission behind it', () => {
  const needs: Record<string, Parameters<typeof can>[1]> = {
    pickups: 'orders.view',
    dropoffs: 'orders.view',
    dispatched: 'orders.view',
    transactions: 'payments.view',
    customers: 'customers.view',
    guests: 'guests.view',
    applications: 'applications.review',
    users: 'users.view',
    beats: 'beats.view',
    pincodes: 'pincodes.view',
    settings: 'settings',
  };
  for (const role of OPS_ROLES) {
    for (const tab of OPS_TABS_BY_ROLE[role]) {
      if (tab === 'dashboard') continue;
      assert.ok(can(role, needs[tab]), `${role} sees ${tab} without ${needs[tab]}`);
    }
  }
});

test('only head office and branch managers move orders', () => {
  for (const role of OPS_ROLES) {
    const moves = ['super_admin', 'admin', 'branch_manager'].includes(role);
    assert.equal(can(role, 'orders.act'), moves, role);
    assert.equal(roleSatisfies(role, 'admin'), moves, role);
  }
});

test('KYC documents: super admin, support and KYC reviewers, never admin', () => {
  assert.equal(can('super_admin', 'kyc.view'), true);
  assert.equal(can('customer_support', 'kyc.view'), true);
  assert.equal(can('kyc_reviewer', 'kyc.view'), true);
  assert.equal(can('admin', 'kyc.view'), false);
  assert.equal(can('branch_manager', 'kyc.view'), false);
  assert.equal(can('accounts', 'kyc.view'), false);
});

test('admins create agents, super admins create any staff but another super admin', () => {
  assert.deepEqual(assignableRoles('admin'), ['agent']);
  assert.ok(!assignableRoles('super_admin').includes('super_admin'));
  assert.ok(assignableRoles('super_admin').includes('branch_manager'));
  assert.deepEqual(assignableRoles('branch_manager'), []);
  assert.deepEqual(assignableRoles('customer_support'), []);
});

test('only a branch manager is held to one city', () => {
  for (const role of OPS_ROLES) assert.equal(isCityScoped(role), role === 'branch_manager', role);
});
