// Refresh-token rotation must be atomic: two simultaneous redemptions of one
// token cannot both succeed and fork the chain.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

// A tiny stateful table that honours the conditional UPDATE the way Postgres does.
const table = new Map();
let nextId = 1;
const log = [];
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings, ...vals) => {
		const text = strings.join('?').replace(/\s+/g, ' ').trim();
		log.push(text);
		if (/^select id, user_id, scope, resource, expires_at, revoked_at from oauth_refresh_tokens/.test(text)) {
			// Both racers read before either writes.
			await Promise.resolve();
			const row = [...table.values()].find((r) => r.token_hash === vals[0]);
			return row ? [{ ...row }] : [];
		}
		if (/^insert into oauth_refresh_tokens/.test(text)) {
			const id = `rt-${nextId++}`;
			table.set(id, { id, token_hash: vals[0], user_id: vals[2], client_id: vals[1], scope: vals[3], resource: null, expires_at: new Date(Date.now() + 1e6), revoked_at: null });
			return [{ id }];
		}
		if (/^update oauth_refresh_tokens set revoked_at = now\(\), last_used_at = now\(\) where id = \? and revoked_at is null returning id/.test(text)) {
			const row = table.get(vals[0]);
			if (!row || row.revoked_at) return [];
			row.revoked_at = new Date();
			return [{ id: row.id }];
		}
		if (/^update oauth_refresh_tokens set revoked_at = now\(\), replaced_by/.test(text)) {
			const row = table.get(vals[1]);
			if (row) { row.revoked_at = new Date(); row.replaced_by = vals[0]; }
			return [];
		}
		if (/^update oauth_refresh_tokens set replaced_by/.test(text)) {
			const row = table.get(vals[1]);
			if (row) row.replaced_by = vals[0];
			return [];
		}
		if (/^update oauth_refresh_tokens set revoked_at = now\(\) where user_id/.test(text)) {
			const out = [];
			for (const r of table.values()) if (r.user_id === vals[0] && r.client_id === vals[1] && !r.revoked_at) { r.revoked_at = new Date(); out.push({ id: r.id }); }
			return out;
		}
		return [];
	},
}));

const { issueRefreshToken, rotateRefreshToken } = await import('../api/_lib/auth.js');

beforeEach(() => { table.clear(); nextId = 1; log.length = 0; });

describe('rotateRefreshToken', () => {
	it('lets exactly one of two simultaneous redemptions win and treats the other as reuse', async () => {
		const { token } = await issueRefreshToken({ userId: 'u1', clientId: 'c1', scope: 'read', resource: null });
		const results = await Promise.allSettled([
			rotateRefreshToken({ oldSecret: token, clientId: 'c1' }),
			rotateRefreshToken({ oldSecret: token, clientId: 'c1' }),
		]);
		const won = results.filter((r) => r.status === 'fulfilled');
		const lost = results.filter((r) => r.status === 'rejected');
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(lost[0].reason).toMatchObject({ status: 400, code: 'refresh_reuse_detected' });
		// the chain never forked: at most one successor of the spent token exists
		expect([...table.values()].filter((r) => r.id !== 'rt-1')).toHaveLength(1);
	});

	it('a normal sequential rotation still yields one live successor', async () => {
		const { token } = await issueRefreshToken({ userId: 'u1', clientId: 'c1', scope: 'read write', resource: null });
		const out = await rotateRefreshToken({ oldSecret: token, clientId: 'c1', narrowScope: () => 'read' });
		expect(out.scope).toBe('read');
		const live = [...table.values()].filter((r) => !r.revoked_at);
		expect(live).toHaveLength(1);
		expect(table.get('rt-1').replaced_by).toBe('rt-2');
	});

	it('a rejected narrower scope does not burn the token', async () => {
		const { token } = await issueRefreshToken({ userId: 'u1', clientId: 'c1', scope: 'read', resource: null });
		await expect(rotateRefreshToken({ oldSecret: token, clientId: 'c1', narrowScope: () => { throw Object.assign(new Error('x'), { code: 'invalid_scope' }); } })).rejects.toMatchObject({ code: 'invalid_scope' });
		expect(table.get('rt-1').revoked_at).toBeNull();
	});

	it('replaying a spent token revokes the chain', async () => {
		const { token } = await issueRefreshToken({ userId: 'u1', clientId: 'c1', scope: 'read', resource: null });
		await rotateRefreshToken({ oldSecret: token, clientId: 'c1' });
		await expect(rotateRefreshToken({ oldSecret: token, clientId: 'c1' })).rejects.toMatchObject({ code: 'refresh_reuse_detected' });
		expect([...table.values()].filter((r) => !r.revoked_at)).toHaveLength(0);
	});
});
