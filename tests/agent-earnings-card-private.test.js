// @vitest-environment jsdom
// The Earned card on a private agent's profile. GET /api/agents/:id/earnings
// answers 404 to everyone but the owner of a private agent (on purpose: the
// figures are private), while the profile itself still renders. The card used
// to fetch anyway and paint "Couldn't load earnings" with a Try again button on
// a profile that was plainly there, about 100 times every six hours in
// production. A private agent's earnings are a designed state, not an error.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountEarningsCard } from '../src/shared/agent-earnings-card.js';

const AGENT = '9b1ccebb-5f76-41ac-bcc3-6669c349882c';
const flush = () => new Promise((r) => setTimeout(r, 0));

let mount;
beforeEach(() => {
	mount = document.createElement('div');
	document.body.appendChild(mount);
});
afterEach(() => {
	mount.remove();
	vi.unstubAllGlobals();
});

describe('Earned card on a private agent', () => {
	it('does not ask for earnings a visitor is not allowed to see', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const states = [];
		mountEarningsCard({ mount, agentId: AGENT, isPublic: false, isOwner: false, onState: (s) => states.push(s) });
		await flush();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(states).toEqual(['private']);
		expect(mount.querySelector('[data-ern-retry]')).toBeNull();
		expect(mount.textContent).not.toMatch(/couldn't load/i);
	});

	it('still loads for the owner of a private agent', async () => {
		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ coins: [], claims: [] }), { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		mountEarningsCard({ mount, agentId: AGENT, isPublic: false, isOwner: true });
		await flush();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('treats a 404 as private or removed, not as a failure to retry', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })));
		const states = [];
		mountEarningsCard({ mount, agentId: AGENT, onState: (s) => states.push(s) });
		await flush();
		await flush();
		expect(states.at(-1)).toBe('private');
		expect(mount.querySelector('[data-ern-retry]')).toBeNull();
		expect(mount.textContent).not.toMatch(/couldn't load/i);
	});

	it('keeps the retry for a real outage', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
		const states = [];
		mountEarningsCard({ mount, agentId: AGENT, onState: (s) => states.push(s) });
		await flush();
		await flush();
		expect(states.at(-1)).toBe('error');
		expect(mount.querySelector('[data-ern-retry]')).not.toBeNull();
	});
});
