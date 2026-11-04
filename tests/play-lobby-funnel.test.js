// @vitest-environment jsdom
//
// The /play lobby is the event front door: a first-time visitor lands here from
// an event link and has to be able to answer two questions without hunting.
//
//   1. "What is three.ws?"            -> the product tour (/features)
//   2. "How do I get a world for my own coin?" -> the coin launchpad (/launch)
//
// Both used to be missing from the lobby entirely (the launch page was reachable
// only from other pages), so the event funnel's "two clicks or fewer" promise
// failed. They are pinned here as direct links in the hero, one click each, and
// as entries in the site menu and the mobile drawer.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/game/avatar-thumb.js', () => ({ renderAvatarThumb: vi.fn(async () => null) }));
vi.mock('../src/game/avatar-rig.js', () => ({ resolveAvatarUrl: vi.fn(async (u) => u) }));
vi.mock('../src/account.js', () => ({ getMe: vi.fn(async () => null) }));

const { CommunityUI } = await import('../src/game/coincommunities-ui.js');

beforeEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	vi.stubGlobal('matchMedia', (q) => ({
		matches: /hover: hover/.test(q), media: q,
		addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
	}));
	vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [], data: [] }) })));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function mount() {
	const ui = new CommunityUI({ onEnter: vi.fn(), onSearch: vi.fn(async () => []) });
	ui.setCoins([]);
	return ui;
}

const hrefs = (root, sel) => [...root.querySelectorAll(sel)].map((a) => a.getAttribute('href'));

describe('the /play lobby funnel', () => {
	it('links the hero straight to the coin launchpad and the product tour', () => {
		const ui = mount();
		const hero = ui.lobby.querySelector('.cc-hero');
		const links = hrefs(hero, 'a.cc-hero-link');
		expect(links).toContain('/launch');
		expect(links).toContain('/features');
		for (const a of hero.querySelectorAll('a.cc-hero-link')) expect(a.textContent.trim().length).toBeGreaterThan(0);
	});

	it('lists the launchpad in the desktop menu and the mobile drawer', () => {
		const ui = mount();
		expect(hrefs(ui.lobby, '.cc-nav-main a.cc-nav-mi')).toContain('/launch');
		expect(hrefs(ui.navDrawer, 'a')).toContain('/launch');
	});
});
