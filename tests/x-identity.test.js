// findUserByXId answers "is this X user one of ours?" for the mention-reply
// cron, the forge-creation claim flow, and the mention-to-launch flow (order
// 925). It must check both ways an X account is proven ours: an owner's own
// connected account (social_connections) and one connected to a single agent
// (agent_x_connections), and it must never match a disconnected one.

import { describe, it, expect, vi } from 'vitest';

const queue = [];
const sqlCalls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => {
		sqlCalls.push(String(strings?.raw ? strings.join('?') : strings));
		return queue.length ? queue.shift() : [];
	}),
}));

const { findUserByXId } = await import('../api/_lib/x-identity.js');

describe('findUserByXId', () => {
	it('returns null without querying for a missing or non-string id', async () => {
		expect(await findUserByXId(null)).toBeNull();
		expect(await findUserByXId(undefined)).toBeNull();
		expect(await findUserByXId(12345)).toBeNull();
		expect(sqlCalls.length).toBe(0);
	});

	it('matches an owner X account connected through social_connections', async () => {
		queue.length = 0;
		queue.push([{ user_id: 'user-1', username: 'ownerhandle' }]);
		const result = await findUserByXId('111');
		expect(result).toEqual({ user_id: 'user-1', username: 'ownerhandle' });
	});

	it('falls back to an agent-owned X account via agent_x_connections', async () => {
		queue.length = 0;
		queue.push([]); // no social_connections match
		queue.push([{ user_id: 'user-2', username: 'agenthandle' }]);
		const result = await findUserByXId('222');
		expect(result).toEqual({ user_id: 'user-2', username: 'agenthandle' });
	});

	it('returns null when the X id matches neither table', async () => {
		queue.length = 0;
		queue.push([]);
		queue.push([]);
		const result = await findUserByXId('333');
		expect(result).toBeNull();
	});

	it('queries social_connections before agent_x_connections, both scoped to live links', async () => {
		queue.length = 0;
		queue.push([]);
		queue.push([]);
		sqlCalls.length = 0;
		await findUserByXId('444');
		expect(sqlCalls[0]).toMatch(/social_connections/);
		expect(sqlCalls[0]).toMatch(/disconnected_at is null/);
		expect(sqlCalls[1]).toMatch(/agent_x_connections/);
		expect(sqlCalls[1]).toMatch(/disconnected_at is null/);
	});

	it('a different X id than the one connected never matches', async () => {
		queue.length = 0;
		queue.push([]);
		queue.push([]);
		const result = await findUserByXId('not-connected-id');
		expect(result).toBeNull();
	});
});
