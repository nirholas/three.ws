import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedOrigin, ALLOWED_ORIGINS } from '../src/services/hq-bridge-origins.ts';

describe('hq-bridge isAllowedOrigin', () => {
  it('accepts the exact first-party origins', () => {
    for (const origin of ALLOWED_ORIGINS) assert.equal(isAllowedOrigin(origin), true, origin);
  });

  it('accepts https subdomains of three.ws, matching frame-ancestors', () => {
    assert.equal(isAllowedOrigin('https://app.three.ws'), true);
  });

  it('rejects arbitrary vercel.app hosts (anyone can deploy one)', () => {
    assert.equal(isAllowedOrigin('https://evil.vercel.app'), false);
    assert.equal(isAllowedOrigin('https://three-ws-preview.vercel.app'), false);
  });

  it('rejects lookalike and downgraded origins', () => {
    assert.equal(isAllowedOrigin('https://three.ws.evil.com'), false);
    assert.equal(isAllowedOrigin('https://evilthree.ws'), false);
    assert.equal(isAllowedOrigin('http://app.three.ws'), false);
    assert.equal(isAllowedOrigin('http://three.ws'), false);
    assert.equal(isAllowedOrigin('null'), false);
    assert.equal(isAllowedOrigin(''), false);
  });
});
