// PATCH/PUT /api/agents/:id must not let a caller attach an avatar they do not
// own. handleCreate already scopes avatar_id to the caller; handleUpdate used to
// COALESCE the raw body value straight into the row, and the public manifest
// then resolved that avatar's storage key as if it were public.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
let ownedAvatar = null;

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...vals) => {
		const q = strings.join('?').toLowerCase();
		calls.push({ q, vals });
		if (/from agent_identities/.test(q)) return [{ id: 'a1', user_id: 'u1', meta: {} }];
		if (/from avatars/.test(q)) return ownedAvatar ? [ownedAvatar] : [];
		if (/update agent_identities/.test(q)) return [{ id: 'a1', user_id: 'u1', meta: {} }];
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

vi.mock('../api/_lib/http.js', async (orig) => ({
	...(await orig()),
	readJson: vi.fn(async () => ({ avatar_id: '11111111-1111-4111-8111-111111111111' })),
}));

const { handleUpdate } = await import('../api/agents.js');

function res() {
	return {
		statusCode: 0,
		headers: {},
		setHeader(k, v) { this.headers[k] = v; },
		end(b) { this.body = b; },
	};
}

describe('agents: handleUpdate avatar ownership', () => {
	beforeEach(() => {
		calls.length = 0;
		ownedAvatar = null;
	});

	it('rejects an avatar_id the caller does not own and never writes it', async () => {
		const r = res();
		await handleUpdate({ headers: {} }, r, 'a1', { userId: 'u1', source: 'session' });
		expect(r.statusCode).toBe(404);
		expect(calls.some((c) => /update agent_identities/.test(c.q))).toBe(false);
	});

	it('accepts an avatar the caller owns', async () => {
		ownedAvatar = { id: '11111111-1111-4111-8111-111111111111' };
		const r = res();
		await handleUpdate({ headers: {} }, r, 'a1', { userId: 'u1', source: 'session' });
		expect(r.statusCode).toBe(200);
		expect(calls.some((c) => /update agent_identities/.test(c.q))).toBe(true);
	});
});
