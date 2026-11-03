// The account's own wallet: link lookup, live read, the all-wallet overview and
// the two MCP tools on top. Faked: the Postgres template and the chain reader.
import { test, expect, vi, beforeEach } from 'vitest';

let linked = null;
let agentRows = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings) => {
		const text = strings.join('?');
		if (/from user_wallets/i.test(text)) return linked ? [{ address: linked }] : [];
		if (/from agent_identities/i.test(text)) return agentRows;
		return [];
	},
}));
vi.mock('../api/_lib/rate-limit.js', () => ({ limits: { mcpAgent: async () => ({ success: true }), walletRead: async () => ({ success: true }) } }));

const reader = { calls: [] };
const fakeRead = async ({ address, network }) => {
	reader.calls.push({ address, network });
	return { address, network, lamports: 3_000_000_000n, sol: 3, usdc_raw: 10_000_000n, usdc: 10, sol_usd: 100, usd_total: 310 };
};

const { readPrivateWallet, readWalletSummaries } = await import('../api/_lib/custody/private-wallet.js');
const { privateWalletToolDefs } = await import('../api/_mcpagent/private-wallet-tools.js');
const { POLICY } = await import('../packages/mcp-policy/src/table.js');

beforeEach(() => { linked = null; agentRows = []; reader.calls.length = 0; });

test('no linked wallet is reported, not invented', async () => {
	const w = await readPrivateWallet('u1', 'mainnet', { readSolUsdc: fakeRead });
	expect(w).toEqual({ linked: false, network: 'mainnet' });
	expect(reader.calls).toHaveLength(0);
});

test('a linked wallet is read live with SOL and USDC', async () => {
	linked = 'WalletAddr1111111111111111111111111111111111';
	const w = await readPrivateWallet('u1', 'devnet', { readSolUsdc: fakeRead });
	expect(w).toMatchObject({ linked: true, address: linked, network: 'devnet', sol: 3, usdc: 10, usd_total: 310, lamports: '3000000000' });
	expect(reader.calls[0]).toEqual({ address: linked, network: 'devnet' });
});

test('an unknown network is a 400, not a silent mainnet read', async () => {
	await expect(readPrivateWallet('u1', 'testnet', { readSolUsdc: fakeRead })).rejects.toMatchObject({ status: 400, code: 'invalid_parameter' });
});

test('summaries total agent snapshots plus the private wallet and count the unsnapshotted', async () => {
	linked = 'WalletAddr1111111111111111111111111111111111';
	agentRows = [
		{ agent_id: 'a1', name: 'Alpha', address: 'x', captured_at: '2026-11-03T10:00:00Z', lamports: '1000000000', usdc_raw: '5000000', sol_usd: '100', usd_total: '105' },
		{ agent_id: 'a2', name: 'Beta', address: 'y', captured_at: null, lamports: null, usdc_raw: null, sol_usd: null, usd_total: null },
	];
	const s = await readWalletSummaries('u1', 'mainnet', { readSolUsdc: fakeRead });
	expect(s.total_usd).toBe(415);
	expect(s.agents_without_snapshot).toBe(1);
	expect(s.agents[0]).toMatchObject({ name: 'Alpha', sol: 1, usdc: 5 });
});

const tool = (n) => privateWalletToolDefs.find((t) => t.name === n);

test('tools refuse an anonymous caller and a token without wallet scope', async () => {
	const anon = await tool('get_private_wallet_balance').handler({}, { userId: null });
	expect(anon.structuredContent.reason).toBe('auth_required');
	const noScope = await tool('get_wallet_summaries').handler({}, { userId: 'u1', scope: 'profile' });
	expect(noScope.structuredContent.reason).toBe('insufficient_scope');
});

test('tool says plainly when no wallet is linked', async () => {
	const out = await tool('get_private_wallet_balance').handler({}, { userId: 'u1', scope: 'wallet:read' });
	expect(out.structuredContent).toMatchObject({ ok: true, linked: false });
	expect(out.content[0].text).toMatch(/No Solana wallet is linked/);
});

test('both tools are read tier in the policy table and declared read-only', () => {
	for (const name of ['get_private_wallet_balance', 'get_wallet_summaries']) {
		expect(POLICY['threews-agent']?.[name] || Object.values(POLICY).find((t) => t[name])?.[name]).toMatchObject({ tier: 'read', group: 'wallet' });
		expect(tool(name).tier).toBe('read');
		expect(tool(name).annotations.readOnlyHint).toBe(true);
	}
});
