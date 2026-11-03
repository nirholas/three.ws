// /drive's copilot picker on a signed-out head unit or phone: it must not ask
// for "my avatars" without a session, because the 401 that comes back is a
// console error on every kiosk boot. The probe /api/auth/me answers 200 with
// { user: null } for anonymous callers, so the picker asks that first.
import { describe, it, expect } from 'vitest';
import { listChoices } from '../src/drive/choices.js';

function server(routes) {
	const calls = [];
	const fetchImpl = async (url) => {
		calls.push(url);
		const route = routes[url];
		if (!route) return new Response('not found', { status: 404 });
		return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } });
	};
	return { calls, fetchImpl };
}

const featured = { avatars: [{ id: 'f1', name: 'Public' }] };

describe('drive listChoices', () => {
	it('signed out: never requests the owner-only list, shows featured', async () => {
		const { calls, fetchImpl } = server({
			'/api/auth/me': { body: { user: null } },
			'/api/avatars?limit=24': { status: 401, body: { error: 'unauthenticated' } },
			'/api/avatars/featured?limit=24': { body: featured },
		});
		expect(await listChoices(fetchImpl)).toEqual({ avatars: featured.avatars, owned: false });
		expect(calls).not.toContain('/api/avatars?limit=24');
	});

	it('signed in with avatars: shows the owner their own', async () => {
		const mine = { avatars: [{ id: 'm1', name: 'Mine' }] };
		const { fetchImpl } = server({
			'/api/auth/me': { body: { user: { id: 'u1' } } },
			'/api/avatars?limit=24': { body: mine },
			'/api/avatars/featured?limit=24': { body: featured },
		});
		expect(await listChoices(fetchImpl)).toEqual({ avatars: mine.avatars, owned: true });
	});

	it('signed in with none yet: falls back to featured', async () => {
		const { fetchImpl } = server({
			'/api/auth/me': { body: { user: { id: 'u1' } } },
			'/api/avatars?limit=24': { body: { avatars: [] } },
			'/api/avatars/featured?limit=24': { body: featured },
		});
		expect(await listChoices(fetchImpl)).toEqual({ avatars: featured.avatars, owned: false });
	});

	it('featured unavailable: a readable error', async () => {
		const { fetchImpl } = server({
			'/api/auth/me': { body: { user: null } },
			'/api/avatars/featured?limit=24': { status: 503, body: {} },
		});
		await expect(listChoices(fetchImpl)).rejects.toThrow('Could not load agents (503).');
	});
});
