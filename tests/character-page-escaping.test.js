// @vitest-environment jsdom
//
// /character/:id renders an agent's owner-controlled fields (name, meta.token,
// meta.memes, meta.profile_image_url) for every visitor. Those strings must
// reach the page as text, never as markup, and remote image URLs must never
// carry a non-http(s) scheme.

import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../src/shared/onchain-badge.js', () => ({ onchainBadgeEl: () => null }));
vi.mock('../src/shared/agent-wallet-chip.js', () => ({ walletChipEl: () => null }));
vi.mock('../src/shared/wallet-aura.js', () => ({ hydrateAvatarWallet: () => Promise.resolve(null) }));
vi.mock('../src/ui-juice.css', () => ({}));
vi.mock('../src/ui-juice.js', () => ({
	countUp: (el, _from, to, { format } = {}) => {
		if (el) el.textContent = format ? format(to) : String(to);
	},
}));
vi.mock('../src/shared/failover-fetch.js', () => ({ fetchFirstOrNull: async () => null }));

const AGENT_ID = '0b9c3a7e-4d2f-4f6a-9e1b-2c3d4e5f6a7b';
const NAME = '"><iframe srcdoc="<b>x</b>"></iframe>';
const SYMBOL = '<iframe srcdoc="pwn"></iframe>';
const HOLDERS = '<form action="https://evil.example"><input name=p></form>';
const CREATOR = '<a href="https://evil.example">claim</a>';

const agent = {
	id: AGENT_ID,
	name: NAME,
	description: 'desc',
	chat_count: 3,
	meta: {
		profile_image_url: '" onerror="alert(1)',
		token: { symbol: SYMBOL, holders: HOLDERS, mint: 'THREEsynthetic1111111111111111111111111111' },
		memes: [
			{ image_url: 'javascript:alert(1)', creator: CREATOR },
			{ image_url: 'https://cdn.example/meme.png', creator: 'alice' },
		],
	},
};

function mountShell() {
	document.body.innerHTML = `
		<div class="ch-shell ch-loading">
			<div id="ch-avatar-wrap"><img id="ch-avatar-img" /><div id="ch-avatar-ph"></div></div>
			<h1 id="ch-name"></h1>
			<div id="ch-creator"></div>
			<span id="ch-stat-chats"></span><span id="ch-stat-holders"></span>
			<p id="ch-desc"></p>
			<a id="ch-chat-btn"></a>
			<section id="ch-token-section"></section>
			<div id="ch-memes-grid"></div>
		</div>`;
}

beforeAll(async () => {
	window.history.replaceState(null, '', `/character/${AGENT_ID}`);
	mountShell();
	globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ agent }) }));
	await import('../src/character.js');
	await vi.waitFor(() => {
		expect(document.querySelector('.ch-meme-item')).not.toBeNull();
	});
});

describe('character page escaping', () => {
	it('injects no markup from owner-controlled fields', () => {
		expect(document.querySelector('iframe')).toBeNull();
		expect(document.querySelector('form')).toBeNull();
		expect(document.querySelector('.ch-meme-author a')).toBeNull();
	});

	it('renders the token symbol and holder count as text', () => {
		expect(document.querySelector('.ch-token-name').textContent).toBe(SYMBOL);
		const vals = [...document.querySelectorAll('.ch-token-meta-val')].map((el) => el.textContent);
		expect(vals).toContain(HOLDERS);
		expect(vals).toContain('$' + SYMBOL);
	});

	it('keeps the agent name inside the alt attribute', () => {
		const img = document.querySelector('.ch-meme-create-icon img');
		expect(img.getAttribute('alt')).toBe(NAME);
		expect(img.hasAttribute('onerror')).toBe(false);
	});

	it('drops non-http(s) meme image URLs and keeps https ones', () => {
		const imgs = [...document.querySelectorAll('.ch-meme-item img')];
		expect(imgs[0].getAttribute('src')).toBe('');
		expect(imgs[1].getAttribute('src')).toBe('https://cdn.example/meme.png');
	});

	it('renders meme creators as text', () => {
		const authors = [...document.querySelectorAll('.ch-meme-author')].map((el) => el.textContent);
		expect(authors).toEqual([CREATOR, 'alice']);
	});
});
