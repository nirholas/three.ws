import { describe, it, expect } from 'vitest';
import { planBuyback, BUYBACK_DEFAULTS } from '../api/_lib/event-markets/staking/buyback.js';

const base = { balance: 50_000_000n, requested: null, expectedOutRaw: 2_000_000_000n, priceImpactPct: 0.4, ...BUYBACK_DEFAULTS };

describe('planBuyback guards', () => {
	it('spends the whole balance by default and enforces the slippage floor', () => {
		const p = planBuyback(base);
		expect(p.ok).toBe(true);
		expect(p.spend).toBe(50_000_000n);
		expect(p.minOutRaw).toBe(1_980_000_000n);
	});
	it('honours a requested amount inside the balance', () => {
		expect(planBuyback({ ...base, requested: 10_000_000n }).spend).toBe(10_000_000n);
	});
	it('refuses an amount above the balance', () => {
		const p = planBuyback({ ...base, requested: 60_000_000n });
		expect(p.ok).toBe(false);
		expect(p.reason).toMatch(/exceeds/);
	});
	it('refuses an empty wallet', () => {
		expect(planBuyback({ ...base, balance: 0n }).ok).toBe(false);
	});
	it('refuses a quote with more price impact than the bound', () => {
		const p = planBuyback({ ...base, priceImpactPct: 3.5 });
		expect(p.ok).toBe(false);
		expect(p.reason).toMatch(/price impact/);
	});
	it('refuses a quote that returns nothing', () => {
		expect(planBuyback({ ...base, expectedOutRaw: 0n }).ok).toBe(false);
	});
	it('rejects out-of-range slippage and impact bounds', () => {
		expect(planBuyback({ ...base, maxSlippageBps: 0 }).ok).toBe(false);
		expect(planBuyback({ ...base, maxSlippageBps: 900 }).ok).toBe(false);
		expect(planBuyback({ ...base, maxPriceImpactPct: 50 }).ok).toBe(false);
	});
});

describe('admin CLI mainnet gate', () => {
	it('prints the table and sends nothing without --yes, and refuses mainnet without --confirm-mainnet', async () => {
		const { spawnSync } = await import('node:child_process');
		const { mkdtempSync, writeFileSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		const { Keypair } = await import('@solana/web3.js');
		const dir = mkdtempSync(join(tmpdir(), 'stake-admin-'));
		const kp = join(dir, 'authority.json');
		writeFileSync(kp, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
		const run = (cluster, ...args) => spawnSync(process.execPath, ['scripts/event-markets-stake-admin.mjs', 'pause', ...args], {
			env: { PATH: process.env.PATH, EVENT_MARKETS_STAKE_CLUSTER: cluster, EVENT_MARKETS_STAKE_PROGRAM_ID: '6DsLYSQcYZSegSKgRkRMP93L7uHxvV1cQhm6YoXa9xXU', EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR: kp },
			encoding: 'utf8',
		});
		const dry = run('devnet');
		expect(dry.stdout).toContain('Dry run');
		expect(dry.stdout).not.toContain('sent ');
		const refused = run('mainnet', '--yes');
		expect(refused.stdout).toContain('Mainnet needs --confirm-mainnet');
		expect(refused.stdout).not.toContain('sent ');
	}, 30_000);
});
