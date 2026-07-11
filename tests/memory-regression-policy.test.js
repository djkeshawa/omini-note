const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAuthenticationError,
  shouldSkipOptionalSecuredServer,
} = require('../scripts/memory-regression-policy');

test('memory regression policy recognizes common authentication failures', () => {
  assert.equal(isAuthenticationError(new Error('{"detail":"Authentication required"}')), true);
  assert.equal(isAuthenticationError({ message: 'Request failed', status: 401 }), true);
  assert.equal(isAuthenticationError(new Error('connection refused')), false);
});

test('optional secured memory servers skip only when no API key is configured', () => {
  const error = new Error('Authentication required');
  assert.equal(shouldSkipOptionalSecuredServer({ error }), true);
  assert.equal(shouldSkipOptionalSecuredServer({ error, apiKey: 'configured' }), false);
  assert.equal(shouldSkipOptionalSecuredServer({ error, required: true }), false);
  assert.equal(shouldSkipOptionalSecuredServer({ error: new Error('timeout') }), false);
});
