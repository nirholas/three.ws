// @vitest-environment jsdom
// The badge renders one chip per name claim the resolver reports.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const REF = 'eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/42';

function stubResolver(body) {
	globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
}

async function mount() {
	const el = document.createElement('three-d-agent-badge');
	el.setAttribute('agent', REF);
	const done = new Promise((resolve) => el.addEventListener('verified', (e) => resolve(e.detail)));
	document.body.append(el);
	const detail = await done;
	return { el, detail, chips: [...el.shadowRoot.querySelectorAll('.claim')] };
}

beforeAll(async () => {
	await import('../src/erc8004/badge.js');
});
beforeEach(() => {
	document.body.innerHTML = '';
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('<three-d-agent-badge> claims', () => {
	it('renders a distinct accessible chip per claim state', async () => {
		stubResolver({
			card: { name: 'Leo' },
			claims: [
				{ type: 'ens', name: 'leo.eth', verified: true, state: 'verified' },
				{ type: 'dns', name: 'leo.com', verified: false, state: 'half_from_agent', reason: 'no matching ref' },
				{ type: 'ens', name: 'other.eth', verified: false, state: 'half_from_name' },
				{ type: 'ens', name: 'bad.eth', verified: false, state: 'unverified' },
			],
		});
		const { chips, detail } = await mount();
		expect(chips.map((c) => c.dataset.state)).toEqual(['verified', 'half_from_agent', 'half_from_name', 'unverified']);
		expect(chips[1].getAttribute('aria-label')).toMatch(/DNS name leo\.com.*does not point back.*no matching ref/);
		expect(chips.every((c) => c.tabIndex === 0)).toBe(true);
		expect(detail.claims).toHaveLength(4);
	});

	it('renders no claims container when the resolver reports none', async () => {
		stubResolver({ card: { name: 'Leo' } });
		const { el, chips, detail } = await mount();
		expect(chips).toHaveLength(0);
		expect(el.shadowRoot.querySelector('.claims')).toBeNull();
		expect(detail.claims).toEqual([]);
	});

	it('escapes hostile claim text', async () => {
		stubResolver({ card: {}, claims: [{ type: 'dns', name: '<img src=x onerror=alert(1)>', state: 'unverified' }] });
		const { el } = await mount();
		expect(el.shadowRoot.querySelector('.claim img')).toBeNull();
	});
});
