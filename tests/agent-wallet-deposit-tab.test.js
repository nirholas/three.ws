// @vitest-environment jsdom
//
// Agent Wallet hub — Deposit tab. Mounts the real tab against a mocked Solana
// wallet client and asserts the public-safe funding surface: the Solana-Pay QR +
// deep-link, copy control, optional amount that rewrites the URI, and the live
// "funds received" confirmation that fires ONLY on a real on-chain balance
// increase (never simulated).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchAgentSolanaWallet = vi.fn();
const fetchAgentSolanaActivity = vi.fn();

vi.mock('../src/agent-solana-wallet.js', () => ({
	fetchAgentSolanaWallet: (...a) => fetchAgentSolanaWallet(...a),
	fetchAgentSolanaActivity: (...a) => fetchAgentSolanaActivity(...a),
}));

// The Deposit tab renders its QR from the shared Solana-Pay builder, which is the
// one canonical source every surface (deposit tab, IRL/AR, portable embed) shares.
const { buildSolanaPayUri } = await import('../src/shared/solana-pay.js');
// Importing the deposit tab module still registers it for the tab-registry assertions.
await import('../src/agent-wallet-hub/tabs/deposit.js');
const { getRegisteredTabs } = await import('../src/agent-wallet-hub/registry.js');
const depositTab = getRegisteredTabs().find((t) => t.id === 'deposit');

const ADDR = 'THREEsynthetic1111111111111111111111111111';

function makeCtx(overrides = {}) {
	return {
		agentId: 'agent-1',
		agent: { id: 'agent-1', name: 'Nova', solana_address: ADDR },
		isOwner: false,
		network: 'mainnet',
		getNetwork: () => 'mainnet',
		onNetworkChange: () => () => {},
		escapeHtml: (s) =>
			String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
		shortAddress: (a, h = 4, t = 4) => (!a ? '' : a.length <= h + t + 1 ? a : `${a.slice(0, h)}…${a.slice(-t)}`),
		copyToClipboard: vi.fn(async () => true),
		toast: vi.fn(),
		openTab: vi.fn(),
		...overrides,
	};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function mountTab(ctx = makeCtx()) {
	const panel = document.createElement('div');
	document.body.appendChild(panel);
	const inst = depositTab.mount({ panel, ctx });
	return { panel, inst, ctx };
}

beforeEach(() => {
	fetchAgentSolanaWallet.mockReset();
	fetchAgentSolanaActivity.mockReset();
	fetchAgentSolanaActivity.mockResolvedValue({ signatures: [] });
	document.body.innerHTML = '';
});

describe('buildSolanaPayUri', () => {
	it('builds a valid Solana-Pay URI with a label', () => {
		const uri = buildSolanaPayUri(ADDR, { label: 'Nova' });
		expect(uri).toBe(`solana:${ADDR}?label=Nova`);
	});
	it('includes a positive amount and omits a non-positive one', () => {
		expect(buildSolanaPayUri(ADDR, { amount: '0.5', label: 'Nova' })).toContain('amount=0.5');
		expect(buildSolanaPayUri(ADDR, { amount: '0', label: 'Nova' })).not.toContain('amount=');
		expect(buildSolanaPayUri(ADDR, { amount: 'abc' })).toBe(`solana:${ADDR}`);
	});
	it('returns null without an address', () => {
		expect(buildSolanaPayUri('')).toBeNull();
	});
});

describe('Deposit tab — public funding surface', () => {
	it('is a non-owner-visible tab', () => {
		expect(depositTab).toBeTruthy();
		expect(depositTab.ownerOnly).toBe(false);
	});

	it('renders the QR, address, copy control and who-you-are-funding header', async () => {
		fetchAgentSolanaWallet.mockResolvedValue({ status: 'ok', data: { address: ADDR, sol: 0, deposits_enabled: true } });
		const { panel, inst } = mountTab();
		inst.onShow();
		await tick();

		expect(panel.textContent).toContain('Nova');
		expect(panel.textContent).toContain(ADDR);
		// First-party QR is inline SVG (no third-party CDN script).
		expect(panel.querySelector('a.awh-dep-qr svg')).toBeTruthy();
		// The QR/deep-link encode a valid solana: URI with the agent label.
		const href = panel.querySelector('a.awh-dep-qr')?.getAttribute('href');
		expect(href).toBe(`solana:${ADDR}?label=Nova`);
		expect(panel.querySelector('[data-act="copy"]')).toBeTruthy();
		inst.destroy();
	});

	it('shows the calm "waiting for your first deposit" state before any funds land', async () => {
		fetchAgentSolanaWallet.mockResolvedValue({ status: 'ok', data: { address: ADDR, sol: 0, deposits_enabled: true } });
		const { panel, inst } = mountTab();
		inst.onShow();
		await tick();
		expect(panel.querySelector('.awh-dep-status[data-state="waiting"]')).toBeTruthy();
		expect(panel.textContent).toMatch(/Waiting for your first deposit/i);
		inst.destroy();
	});

	it('rewrites the deep-link with ?amount= when an amount is entered', async () => {
		vi.useFakeTimers();
		try {
			fetchAgentSolanaWallet.mockResolvedValue({ status: 'ok', data: { address: ADDR, sol: 0, deposits_enabled: true } });
			const { panel, inst } = mountTab();
			inst.onShow();
			await vi.runOnlyPendingTimersAsync();

			const input = panel.querySelector('[data-input="amount"]');
			input.value = '0.25';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			await vi.advanceTimersByTimeAsync(300);

			const href = panel.querySelector('a.awh-dep-qr')?.getAttribute('href');
			expect(href).toContain('amount=0.25');
			expect(panel.querySelector('[data-host="deeplink"]')?.getAttribute('href')).toContain('amount=0.25');
			inst.destroy();
		} finally {
			vi.useRealTimers();
		}
	});

	it('fires the "received" confirmation only on a real balance increase', async () => {
		vi.useFakeTimers();
		try {
			// The first pending-timer flush also runs the initial poll interval. Keep
			// returning the baseline until the test explicitly simulates a deposit.
			fetchAgentSolanaWallet.mockResolvedValue({ status: 'ok', data: { address: ADDR, sol: 0, deposits_enabled: true } });
			const ctx = makeCtx();
			const { panel, inst } = mountTab(ctx);
			inst.onShow();
			await vi.runOnlyPendingTimersAsync();
			// No deposit yet → still waiting, no toast.
			expect(ctx.toast).not.toHaveBeenCalled();

			// Next poll observes a real on-chain increase.
			fetchAgentSolanaWallet.mockResolvedValue({ status: 'ok', data: { address: ADDR, sol: 0.5, deposits_enabled: true } });
			await vi.advanceTimersByTimeAsync(15_000);
			await vi.runOnlyPendingTimersAsync();

			expect(panel.querySelector('.awh-dep-status[data-state="received"]')).toBeTruthy();
			expect(panel.textContent).toMatch(/0\.5 SOL received/i);
			expect(ctx.toast).toHaveBeenCalledWith(expect.stringMatching(/0\.5 SOL received/i));
			inst.destroy();
		} finally {
			vi.useRealTimers();
		}
	});

	it('fails closed without funding controls when wallet health cannot be verified', async () => {
		fetchAgentSolanaWallet.mockResolvedValue({ status: 'error', error: 'rpc down' });
		const { panel, inst } = mountTab();
		inst.onShow();
		await tick();
		// The address may remain visible for identification, but it cannot be copied,
		// encoded in a QR/deep-link, or tipped until the API proves it is signable.
		expect(panel.textContent).toContain(ADDR);
		expect(panel.textContent).toMatch(/Do not send funds/i);
		expect(panel.querySelector('a.awh-dep-qr')).toBeNull();
		expect(panel.querySelector('[data-host="deeplink"]')).toBeNull();
		expect(panel.querySelector('[data-act="copy"]')).toBeNull();
		expect(panel.querySelector('[data-act="tip"]')).toBeNull();
		inst.destroy();
	});

	it('removes every funding affordance for a retired-key wallet', async () => {
		fetchAgentSolanaWallet.mockResolvedValue({
			status: 'ok',
			data: { address: ADDR, sol: 1, deposits_enabled: false, deposits_disabled_reason: 'key_retired' },
		});
		const { panel, inst } = mountTab();
		inst.onShow();
		await tick();

		expect(panel.textContent).toMatch(/Deposits are disabled/i);
		expect(panel.textContent).toMatch(/Do not send funds/i);
		expect(panel.querySelector('a.awh-dep-qr')).toBeNull();
		expect(panel.querySelector('[data-host="deeplink"]')).toBeNull();
		expect(panel.querySelector('[data-act="copy"]')).toBeNull();
		expect(panel.querySelector('[data-act="tip"]')).toBeNull();
		inst.destroy();
	});

	it('never throws or blanks the panel on an extreme agent name (QR stays scannable)', async () => {
		fetchAgentSolanaWallet.mockResolvedValue({ status: 'ok', data: { address: ADDR, sol: 0, deposits_enabled: true } });
		const longName = '🚀'.repeat(300); // emoji → 4 bytes each, far past QR capacity
		const ctx = makeCtx({ agent: { id: 'agent-1', name: longName, solana_address: ADDR } });
		const { panel, inst } = mountTab(ctx);
		inst.onShow();
		await tick();
		// Address + a real QR still render; nothing threw out of render().
		expect(panel.textContent).toContain(ADDR);
		expect(panel.querySelector('a.awh-dep-qr svg')).toBeTruthy();
		const href = panel.querySelector('a.awh-dep-qr')?.getAttribute('href');
		expect(href?.startsWith(`solana:${ADDR}`)).toBe(true);
		inst.destroy();
	});

	it('shows the "wallet being prepared" state when no address exists anywhere', async () => {
		fetchAgentSolanaWallet.mockResolvedValue({ status: 'none' });
		const ctx = makeCtx({ agent: { id: 'agent-1', name: 'Nova' } });
		const { panel, inst } = mountTab(ctx);
		inst.onShow();
		await tick();
		expect(panel.textContent).toMatch(/still being prepared/i);
		inst.destroy();
	});
});
