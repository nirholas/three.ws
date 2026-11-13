// @vitest-environment jsdom
// The world Visibility dialog asks for a $THREE tier pass only when the change is
// the one the server gates: flipping a world to private (gatePrivate in
// api/world/[action].js). Going public, inviting and uninviting are owner-only and
// never tier-checked, so minting a pass for them cost a request (and, for an
// account with no linked wallet, a 403 in the console) on every click.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getTierPass = vi.fn(async () => null);
const getAccess = vi.fn(async () => ({ access: { eligible: true } }));

vi.mock('../src/three-access.js', () => ({
	getAccess: (...a) => getAccess(...a),
	getTierPass: (...a) => getTierPass(...a),
	attachTierPass: (h) => h,
	onGate: vi.fn(),
}));

const { openWorldVisibility } = await import('../src/game/world-visibility.js');

function okFetch(body) {
	return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function optionButton(root, label) {
	return [...root.querySelectorAll('.cc-wv-opt')].find((b) => b.textContent.startsWith(label));
}

describe('world visibility dialog tier pass', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		getTierPass.mockClear();
		getAccess.mockClear();
	});

	it('mints a tier pass before making a world private', async () => {
		const store = { worldId: 'coin-a', visibility: 'public', invitees: [] };
		const fetchImpl = okFetch({ worldId: 'coin-a', visibility: 'private', invitees: [] });
		const onChanged = vi.fn();
		const { root, close } = openWorldVisibility({ store, fetchImpl, onChanged });
		await settle();
		optionButton(root, 'Private').click();
		await settle();
		expect(getTierPass).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(onChanged).toHaveBeenCalledWith({ visibility: 'private', invitees: [] });
		close();
	});

	it('skips the mint when the access read already says this identity is below Silver, and shows the upsell', async () => {
		getAccess.mockResolvedValueOnce({ access: { eligible: false } });
		const { onGate } = await import('../src/three-access.js');
		const store = { worldId: 'coin-a', visibility: 'public', invitees: [] };
		const gateBody = { error: 'three_hold_required', feature: 'worlds.private' };
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify(gateBody), { status: 402, headers: { 'content-type': 'application/json' } }));
		const { root, close } = openWorldVisibility({ store, fetchImpl });
		await settle();
		// Below Silver the option is titled with the tier it needs, so pick it by role.
		root.querySelectorAll('.cc-wv-opt')[1].click();
		await settle();
		expect(getTierPass).not.toHaveBeenCalled();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(onGate).toHaveBeenCalledWith(gateBody);
		close();
	});

	it('does not mint a tier pass to make a world public', async () => {
		const store = { worldId: 'coin-a', visibility: 'private', invitees: [] };
		const fetchImpl = okFetch({ worldId: 'coin-a', visibility: 'public', invitees: [] });
		const { root, close } = openWorldVisibility({ store, fetchImpl });
		await settle();
		optionButton(root, 'Public').click();
		await settle();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(getTierPass).not.toHaveBeenCalled();
		close();
	});

	it('does not mint a tier pass to invite someone', async () => {
		const store = { worldId: 'coin-a', visibility: 'private', invitees: [] };
		const fetchImpl = okFetch({ worldId: 'coin-a', visibility: 'private', invitees: [{ id: 'u-bob', username: 'bob' }] });
		const onChanged = vi.fn();
		const { root, close } = openWorldVisibility({ store, fetchImpl, onChanged });
		await settle();
		root.querySelector('.cc-wv-invite input').value = 'bob';
		root.querySelector('.cc-wv-invite').dispatchEvent(new Event('submit', { cancelable: true }));
		await settle();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(getTierPass).not.toHaveBeenCalled();
		expect(onChanged).toHaveBeenCalledTimes(1);
		close();
	});
});
