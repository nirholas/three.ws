import { describe, expect, it } from 'vitest';
import { ROUTES as ME } from '../api/_lib/agents-v1/routes/me.js';
import { ROUTES as REST } from '../api/v1/rest.js';

const find = (method, path) => ME.find((r) => r.method === method && r.path === path);
const run = (method, path, ctx) => Promise.resolve().then(() => find(method, path).handler(ctx));

describe('me routes are mounted', () => {
	it.each([
		['GET', '/me/usage'], ['GET', '/me/budget'], ['GET', '/me/transactions'], ['GET', '/me/integrations'],
		['PUT', '/me/integrations/:provider'], ['DELETE', '/me/integrations/:provider'],
		['POST', '/me/link-code'], ['POST', '/me/link-code/redeem'],
	])('%s %s', (method, path) => {
		expect(REST.some((r) => r.method === method && r.path === path)).toBe(true);
	});
	it('every authenticated me route needs a scope, and redeem is the only public one', () => {
		for (const r of ME) {
			if (r.auth === 'public') expect(r.path).toBe('/me/link-code/redeem');
			else expect(r.scope).toBe('profile');
		}
	});
});

describe('GET /me/status', () => {
	it('is mounted behind the profile scope', () => {
		const r = REST.find((x) => x.method === 'GET' && x.path === '/me/status');
		expect(r).toBeTruthy();
		expect(r.scope).toBe('profile');
		expect(r.auth).toBe('required');
	});
});

describe('me route validation (no database needed)', () => {
	const principal = { userId: 'u1', source: 'api_key', scope: 'profile' };

	it('404s an unknown integration provider and lists the real ones', async () => {
		const err = await run('PUT', '/me/integrations/:provider', { params: { provider: 'myspace' }, principal }).catch((e) => e);
		expect(err.status).toBe(404);
		expect(err.details?.providers ?? err.detail?.providers).toEqual(['x', 'github']);
		await expect(run('DELETE', '/me/integrations/:provider', { params: { provider: '../x' }, principal })).rejects.toMatchObject({ status: 404 });
	});

	it('link-code needs a known deviceKind', async () => {
		await expect(run('POST', '/me/link-code', { body: {}, principal, req: {} })).rejects.toMatchObject({ status: 400 });
		await expect(run('POST', '/me/link-code', { body: { deviceKind: 'toaster' }, principal, req: {} })).rejects.toMatchObject({ status: 400, code: 'invalid_parameter' });
	});

	it('a key cannot mint a link code carrying scopes it does not hold', async () => {
		const err = await run('POST', '/me/link-code', { body: { deviceKind: 'cli', scopes: 'agents:write wallet:write' }, principal, req: {} }).catch((e) => e);
		expect(err.status).toBe(403);
		expect(err.code).toBe('insufficient_scope');
	});

	it('transactions rejects a malformed cursor', async () => {
		await expect(run('GET', '/me/transactions', { query: { cursor: 'not-a-uuid' }, principal })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' });
	});
});
