import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewer } from '../src/app/updater.js';

test('isNewer compares release tags with the running version', () => {
  assert.equal(isNewer('v0.46', '0.45.0'), true);
  assert.equal(isNewer('0.45', '0.45.0'), false);
  assert.equal(isNewer('0.45.1', '0.45'), true);
  assert.equal(isNewer('0.9', '0.10'), false, 'numbers, not text');
});
