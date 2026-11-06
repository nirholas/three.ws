// @vitest-environment jsdom
//
// The /play lobby keeps the pinned OFFICIAL $THREE town on screen when the
// trending feed fails.
//
// Reproduces a production bug (2026-11-06): with pump.fun's API unreachable,
// /api/pump/trending failed and setCoinsError() cleared the whole grid, so the
// flagship card vanished behind the "Could not load live coins" notice even
// though its identity is static and its own refresh had succeeded. The front
// door must never depend on the trending feed being up.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/game/avatar-thumb.js', () => ({ renderAvatarThumb: vi.fn(async () => null) }));
vi.mock('../src/game/avatar-rig.js', () => ({ resolveAvatarUrl: vi.fn(async (u) => u) }));
vi.mock('../src/account.js', () => ({ getMe: vi.fn(async () => null) }));

const { CommunityUI } = await import('../src/game/coincommunities-ui.js');
const { HOME_TOWN } = await import('../src/game/home-town.js');

function mountLobby() {
	vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
	return new CommunityUI({ onEnter: vi.fn(), onSearch: vi.fn(async () => []) });
}

beforeEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	// jsdom ships no matchMedia; answer as a plain desktop browser would.
	vi.stubGlobal('matchMedia', (q) => ({
		matches: /hover: hover/.test(q), media: q,
		addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('lobby OFFICIAL pin', () => {
	it('stays on screen, with its name, when the trending feed fails', () => {
		const ui = mountLobby();
		ui.setFeatured({ ...HOME_TOWN, marketCap: 740000 });
		const retry = vi.fn();
		ui.setCoinsError(retry);

		const card = ui.grid.querySelector(`.cc-card[data-mint="${HOME_TOWN.mint}"]`);
		expect(card).not.toBeNull();
		expect(card.querySelector('.cc-card-official')).not.toBeNull();
		expect(card.textContent).toContain('three.ws');

		// The outage notice and its retry still render under the pin.
		const button = [...ui.grid.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
		expect(button).toBeTruthy();
		button.click();
		expect(retry).toHaveBeenCalledTimes(1);
	});

	it('appears when its refresh lands after the trending feed already failed', () => {
		const ui = mountLobby();
		ui.setCoinsError(vi.fn());
		ui.setFeatured({ ...HOME_TOWN, marketCap: 740000 });

		expect(ui.grid.querySelector(`.cc-card[data-mint="${HOME_TOWN.mint}"]`)).not.toBeNull();
		expect([...ui.grid.querySelectorAll('button')].some((b) => b.textContent === 'Retry')).toBe(true);
	});
});
