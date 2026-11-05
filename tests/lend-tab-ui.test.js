// @vitest-environment jsdom
//
// DOM test for the wallet hub Lend tab: loading skeleton, populated position,
// empty position, load error with retry, and the two-step deposit (preview
// first, nothing sent until the confirm button re-sends with confirm:true).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/api.js', () => ({ consumeCsrfToken: async () => 'csrf-token' }));

const { getRegisteredTabs } = await import('../src/agent-wallet-hub/registry.js');
await import('../src/agent-wallet-hub/tabs/lend.js');

const WALLET = 'THREEsynthetic1111111111111111111111111111';
const market = { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', supply_apy: 0.0521, utilization: 0.71, available_liquidity_usd: 1200000 };
const markets = { markets: [market] };
const emptyPos = { venue: 'kamino', venue_name: 'Kamino Lend', wallet: WALLET, has_position: false, deposits: [], borrows: [], stats: null, health_floor: 1.25, earn_rule: null, earn_plan: null };
const fullPos = { ...emptyPos, has_position: true, deposits: [{ mint: market.mint, symbol: 'USDC', amount: 25, value_usd: 25, supply_apy: 0.0521, projected_yearly_usd: 1.3 }], stats: { deposited_usd: 25, borrowed_usd: 0, health_factor: null } };
const preview = { kind: 'deposit', token: 'USDC', amount: '5', amount_usd: 5, all: false, from: WALLET, to: 'Kamino Lend obligation Abc', venue_name: 'Kamino Lend', supply_apy: 0.0521, projected_yearly: 0.26, checks: [{ id: 'a', ok: true, label: 'Simulation passed' }] };

const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
const fail = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });

function mount() {
	const panel = document.createElement('div');
	document.body.appendChild(panel);
	const tab = getRegisteredTabs().find((t) => t.id === 'lend');
	const inst = tab.mount({ panel, ctx: { agentId: '11111111-2222-4333-8444-555555555555', escapeHtml: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) } });
	return { panel, inst };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('wallet hub Lend tab', () => {
	beforeEach(() => { document.body.innerHTML = ''; });

	it('registers as an owner-only tab', () => {
		const tab = getRegisteredTabs().find((t) => t.id === 'lend');
		expect(tab.ownerOnly).toBe(true);
	});

	it('shows a skeleton, then the empty state with guidance', async () => {
		global.fetch = vi.fn(async (u) => (u.endsWith('/markets') ? ok(markets) : ok(emptyPos)));
		const { panel } = mount();
		expect(panel.querySelector('.awl-skel')).toBeTruthy();
		await settle(); await settle();
		expect(panel.textContent).toContain('No lending positions. Set an earn rule to put idle USDC to work');
		expect(panel.textContent).toContain('5.21%');
	});

	it('shows a designed error with retry, and retry reloads', async () => {
		let n = 0;
		global.fetch = vi.fn(async (u) => (n++ < 2 ? fail(503, 'venue_unavailable', 'The lending market could not be read from Solana right now.') : u.endsWith('/markets') ? ok(markets) : ok(fullPos)));
		const { panel } = mount();
		await settle(); await settle();
		expect(panel.querySelector('[role="alert"]').textContent).toContain('could not be read');
		panel.querySelector('[data-act="retry"]').click();
		await settle(); await settle();
		expect(panel.textContent).toContain('$25');
	});

	it('previews first and only sends confirm:true after the confirm button', async () => {
		const posted = [];
		global.fetch = vi.fn(async (u, opts) => {
			if (opts?.method === 'POST') {
				const body = JSON.parse(opts.body);
				posted.push(body);
				return ok(body.confirm ? { ...preview, executed: true, signature: 'sig123' } : preview);
			}
			return u.endsWith('/markets') ? ok(markets) : ok(fullPos);
		});
		const { panel } = mount();
		await settle(); await settle();
		panel.querySelector('[data-form="amount"]').value = '5';
		panel.querySelector('[data-form="amount"]').dispatchEvent(new Event('change', { bubbles: true }));
		panel.querySelector('[data-act="preview"]').click();
		await settle(); await settle();
		expect(posted).toHaveLength(1);
		expect(posted[0].confirm).toBe(false);
		expect(panel.textContent).toContain('Simulation passed');
		panel.querySelector('[data-act="confirm"]').click();
		await settle(); await settle();
		expect(posted).toHaveLength(2);
		expect(posted[1]).toMatchObject({ token: 'USDC', amount: '5', confirm: true });
		expect(panel.textContent).toContain('Deposited 5 USDC');
	});

	it('disables confirm when a preview check fails', async () => {
		global.fetch = vi.fn(async (u, opts) => (opts?.method === 'POST' ? ok({ ...preview, checks: [{ id: 'x', ok: false, label: 'Wallet holds 0 USDC' }] }) : u.endsWith('/markets') ? ok(markets) : ok(fullPos)));
		const { panel } = mount();
		await settle(); await settle();
		panel.querySelector('[data-act="preview"]').click();
		await settle(); await settle();
		expect(panel.querySelector('[data-act="confirm"]').disabled).toBe(true);
	});
});
