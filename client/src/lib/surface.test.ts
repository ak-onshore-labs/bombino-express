import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isSurfaceAgnostic,
  landingPathForRole,
  surfaceForPath,
  surfaceForRole,
} from './surface.js';

test('each role lands in its own app', () => {
  assert.equal(landingPathForRole('agent'), '/agent');
  assert.equal(landingPathForRole('admin'), '/ops');
  assert.equal(landingPathForRole('super_admin'), '/ops');
  assert.equal(landingPathForRole('customer'), '/home');
});

test('an unknown role lands in the customer app rather than nowhere', () => {
  // ITD password logins return arbitrary role strings.
  assert.equal(landingPathForRole('BRANCH MANAGER'), '/home');
  assert.equal(landingPathForRole(undefined), '/home');
  assert.equal(landingPathForRole(''), '/home');
});

test('a path belongs to the app whose prefix it carries', () => {
  assert.equal(surfaceForPath('/agent'), 'agent');
  assert.equal(surfaceForPath('/agent/pickups/1'), 'agent');
  assert.equal(surfaceForPath('/ops'), 'ops');
  assert.equal(surfaceForPath('/ops/customers/abc'), 'ops');
  assert.equal(surfaceForPath('/home'), 'customer');
  assert.equal(surfaceForPath('/orders'), 'customer');
});

test('a path that merely starts with the letters is not that app', () => {
  // The prefix check is on a segment boundary, so these stay customer paths.
  assert.equal(surfaceForPath('/agents-of-change'), 'customer');
  assert.equal(surfaceForPath('/options'), 'customer');
});

test('ops covers both admin roles; everything else is the customer app', () => {
  assert.equal(surfaceForRole('agent'), 'agent');
  assert.equal(surfaceForRole('admin'), 'ops');
  assert.equal(surfaceForRole('super_admin'), 'ops');
  assert.equal(surfaceForRole('customer'), 'customer');
  assert.equal(surfaceForRole('BRANCH MANAGER'), 'customer');
  assert.equal(surfaceForRole(undefined), 'customer');
});

test('auth and legal are reachable from any app, the profile is not', () => {
  for (const path of ['/', '/login', '/signup', '/onboarding', '/privacy']) {
    assert.equal(isSurfaceAgnostic(path), true, path);
  }
  // Deliberately not agnostic: it is the customer's account page.
  assert.equal(isSurfaceAgnostic('/profile'), false);
  assert.equal(isSurfaceAgnostic('/home'), false);
});
