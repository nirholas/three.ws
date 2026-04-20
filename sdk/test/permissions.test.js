/**
 * PermissionsClient — unit tests
 *
 * Uses Node.js built-in test runner (node:test) with an inline global.fetch mock.
 * No network calls are made.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsClient, PermissionError } from '../src/permissions.js';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

let _lastRequest = null;

/**
 * Install a one-shot fetch mock that captures the URL/options and returns
 * the supplied JSON body.
 * @param {object} responseBody
 */
function mockFetch(responseBody) {
	global.fetch = async (url, opts = {}) => {
		_lastRequest = { url: String(url), opts };
		return { json: async () => responseBody };
	};
}

const originalFetch = global.fetch;
after(() => {
	global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// listDelegations
// ---------------------------------------------------------------------------

test('listDelegations — constructs URL with agentId param', async () => {
	mockFetch({ ok: true, delegations: [] });
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	const result = await client.listDelegations({ agentId: 'agent-abc' });
	assert.ok(_lastRequest.url.includes('/api/permissions/list'), 'should hit list endpoint');
	assert.ok(_lastRequest.url.includes('agentId=agent-abc'), 'should include agentId param');
	assert.deepEqual(result, []);
});

test('listDelegations — constructs URL with delegator and status params', async () => {
	mockFetch({ ok: true, delegations: [{ id: '1' }] });
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	await client.listDelegations({ delegator: '0xABC', status: 'active' });
	assert.ok(_lastRequest.url.includes('delegator=0xABC'));
	assert.ok(_lastRequest.url.includes('status=active'));
});

test('listDelegations — sends bearer header when set', async () => {
	mockFetch({ ok: true, delegations: [] });
	const client = new PermissionsClient({ baseUrl: 'https://example.com', bearer: 'tok_test' });
	await client.listDelegations({ agentId: 'x' });
	assert.equal(_lastRequest.opts.headers['Authorization'], 'Bearer tok_test');
});

test('listDelegations — no Authorization header when bearer not set', async () => {
	mockFetch({ ok: true, delegations: [] });
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	await client.listDelegations({ agentId: 'x' });
	assert.equal(_lastRequest.opts.headers['Authorization'], undefined);
});

// ---------------------------------------------------------------------------
// getMetadata
// ---------------------------------------------------------------------------

test('getMetadata — constructs URL with agentId', async () => {
	mockFetch({ ok: true, spec: 'erc-7715/0.1', delegations: [] });
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	const result = await client.getMetadata('my-agent');
	assert.ok(_lastRequest.url.includes('/api/permissions/metadata'));
	assert.ok(_lastRequest.url.includes('agentId=my-agent'));
	assert.equal(result.spec, 'erc-7715/0.1');
});

test('getMetadata — URL-encodes agentId with special characters', async () => {
	mockFetch({ ok: true, spec: 'erc-7715/0.1', delegations: [] });
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	await client.getMetadata('agent with spaces');
	assert.ok(_lastRequest.url.includes('agentId=agent%20with%20spaces'));
});

test('getMetadata — trailing slash in baseUrl is stripped', async () => {
	mockFetch({ ok: true, spec: 'erc-7715/0.1', delegations: [] });
	const client = new PermissionsClient({ baseUrl: 'https://example.com/' });
	await client.getMetadata('ag');
	assert.ok(!_lastRequest.url.includes('//api'), 'should not produce double slash');
});

// ---------------------------------------------------------------------------
// redeem
// ---------------------------------------------------------------------------

test('redeem — POSTs to correct URL', async () => {
	mockFetch({ ok: true, txHash: '0xdeadbeef' });
	const client = new PermissionsClient({ baseUrl: 'https://example.com', bearer: 'tok_redeem' });
	const result = await client.redeem({
		id: 'uuid-1',
		calls: [{ to: '0x1234', data: '0xabcd' }],
	});
	assert.ok(_lastRequest.url.includes('/api/permissions/redeem'));
	assert.equal(_lastRequest.opts.method, 'POST');
	assert.equal(result.txHash, '0xdeadbeef');
});

test('redeem — sends bearer header', async () => {
	mockFetch({ ok: true, txHash: '0xabc' });
	const client = new PermissionsClient({ baseUrl: 'https://example.com', bearer: 'my-bearer' });
	await client.redeem({ id: 'uuid-2', calls: [] });
	assert.equal(_lastRequest.opts.headers['Authorization'], 'Bearer my-bearer');
});

test('redeem — includes id and calls in POST body', async () => {
	mockFetch({ ok: true, txHash: '0x1' });
	const client = new PermissionsClient({ baseUrl: 'https://example.com', bearer: 'tok' });
	const calls = [{ to: '0xTarget', value: '1000', data: '0x' }];
	await client.redeem({ id: 'del-id', calls });
	const body = JSON.parse(_lastRequest.opts.body);
	assert.equal(body.id, 'del-id');
	assert.deepEqual(body.calls, calls);
});

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

test('verify — constructs URL with hash and chainId', async () => {
	mockFetch({ ok: true, valid: true });
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	const result = await client.verify('0xhashvalue', 84532);
	assert.ok(_lastRequest.url.includes('/api/permissions/verify'));
	assert.ok(_lastRequest.url.includes('hash=0xhashvalue'));
	assert.ok(_lastRequest.url.includes('chainId=84532'));
	assert.equal(result.valid, true);
	assert.equal(result.reason, undefined);
});

test('verify — includes reason when server returns it', async () => {
	mockFetch({ ok: true, valid: false, reason: 'delegation_revoked' });
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	const result = await client.verify('0xhash', 11155111);
	assert.equal(result.valid, false);
	assert.equal(result.reason, 'delegation_revoked');
});

// ---------------------------------------------------------------------------
// grant — browser-only guard
// ---------------------------------------------------------------------------

test('grant — throws browser_only PermissionError in Node.js', async () => {
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	// typeof window === 'undefined' in Node — should throw immediately without fetch
	await assert.rejects(
		() =>
			client.grant({
				agentId: 'ag',
				chainId: 84532,
				preset: { token: '0x', maxAmount: '1', period: 'once', targets: [], expiryDays: 7 },
				delegate: '0xDelegate',
				signer: {},
			}),
		(err) => {
			assert.ok(err instanceof PermissionError, 'should be PermissionError');
			assert.equal(err.code, 'browser_only');
			return true;
		},
	);
});

// ---------------------------------------------------------------------------
// revoke — browser-only guard
// ---------------------------------------------------------------------------

test('revoke — throws browser_only PermissionError in Node.js', async () => {
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	await assert.rejects(
		() => client.revoke({ id: 'del-1', delegationHash: '0xhash', signer: {} }),
		(err) => {
			assert.ok(err instanceof PermissionError);
			assert.equal(err.code, 'browser_only');
			return true;
		},
	);
});

// ---------------------------------------------------------------------------
// Error surface — server errors become PermissionError
// ---------------------------------------------------------------------------

test('server 4xx ok:false → PermissionError with server error code', async () => {
	mockFetch({
		ok: false,
		error: 'delegation_not_found',
		message: 'No delegation found for that id',
	});
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	await assert.rejects(
		() => client.getMetadata('bad-agent'),
		(err) => {
			assert.ok(
				err instanceof PermissionError,
				`expected PermissionError, got ${err.constructor.name}`,
			);
			assert.equal(err.code, 'delegation_not_found');
			assert.equal(err.message, 'No delegation found for that id');
			return true;
		},
	);
});

test('403-style ok:false error uses error code when no message', async () => {
	mockFetch({ ok: false, error: 'delegation_revoked' });
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	await assert.rejects(
		() => client.listDelegations({ agentId: 'x' }),
		(err) => {
			assert.ok(err instanceof PermissionError);
			assert.equal(err.code, 'delegation_revoked');
			return true;
		},
	);
});

test('rate_limited error code is preserved', async () => {
	mockFetch({ ok: false, error: 'rate_limited', message: 'Too many requests' });
	const client = new PermissionsClient({ baseUrl: 'https://example.com' });
	await assert.rejects(
		() => client.verify('0xhash', 84532),
		(err) => {
			assert.ok(err instanceof PermissionError);
			assert.equal(err.code, 'rate_limited');
			return true;
		},
	);
});

// ---------------------------------------------------------------------------
// PermissionError shape
// ---------------------------------------------------------------------------

test('PermissionError has correct name, code, and message', () => {
	const err = new PermissionError('scope_exceeded', 'Spend limit exceeded');
	assert.equal(err.name, 'PermissionError');
	assert.equal(err.code, 'scope_exceeded');
	assert.equal(err.message, 'Spend limit exceeded');
	assert.ok(err instanceof Error);
});
