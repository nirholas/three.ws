// A bearer credential must carry `wallet:write` before a REST route spends from a
// custodial wallet.
//
// The MCP tools behind these actions already demanded `wallet:write`, but the REST
// routes accepted ANY valid bearer: an `inference`-only API key, or an OAuth token
// a self-registered client got for "Read your avatars", could withdraw an agent
// wallet to its own address, hire and pay other agents, arm the sniper or the
// autopilot, or launch coins. assertBearerMaySpend is the single gate; this suite
// pins its semantics and that every spending route still calls it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { assertBearerMaySpend, SPEND_SCOPE } from '../api/_lib/spend-scope.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('assertBearerMaySpend', () => {
	const post = { method: 'POST' };

	it('names wallet:write as the spend scope', () => {
		expect(SPEND_SCOPE).toBe('wallet:write');
	});

	it('passes a missing bearer through untouched (the session path never reaches it)', () => {
		expect(assertBearerMaySpend(null, post)).toBeNull();
	});

	it('refuses a write from a bearer that lacks wallet:write with a 403 insufficient_scope', () => {
		for (const scope of ['', 'inference', 'avatars:read', 'profile agents:write wallet:read']) {
			let thrown = null;
			try {
				assertBearerMaySpend({ userId: 'u', scope }, post);
			} catch (e) {
				thrown = e;
			}
			expect(thrown, scope).not.toBeNull();
			expect(thrown.status).toBe(403);
			expect(thrown.code).toBe('insufficient_scope');
			expect(thrown.expose).toBe(true);
		}
	});

	it('allows a write from a bearer that holds wallet:write', () => {
		const b = { userId: 'u', scope: 'avatars:read wallet:write' };
		expect(assertBearerMaySpend(b, post)).toBe(b);
		expect(assertBearerMaySpend(b, { method: 'DELETE' })).toBe(b);
	});

	it('lets safe methods through so a wallet:read key still reads', () => {
		const b = { userId: 'u', scope: 'wallet:read' };
		for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
			expect(assertBearerMaySpend(b, { method })).toBe(b);
		}
	});

	it('treats a request with no method as a write (fail closed)', () => {
		expect(() => assertBearerMaySpend({ userId: 'u', scope: 'inference' }, {})).toThrow(/wallet:write/);
	});
});

describe('every bearer-accepting spend route calls the gate', () => {
	const ROUTES = [
		'api/x402-pay.js',
		'api/x402/pay-by-name.js',
		'api/marketplace/purchase-as-agent.js',
		'api/monetization/withdrawals.js',
		'api/monetization/wallet.js',
		'api/agents/pumpfun/[action].js',
		'api/agents/wallet-intents.js',
		'api/agents/recovery.js',
		'api/agents/agent-trade.js',
		'api/agents/solana-trade.js',
		'api/agents/solana-wallet.js',
		'api/agents/a2a-hire.js',
		'api/agents/a2a-call.js',
		'api/agents/agent-strategy-objects.js',
		'api/agents/sns.js',
		'api/agents/solana-guard.js',
		'api/sniper/strategy.js',
		'api/sniper/close.js',
		'api/launch/mm.js',
		'api/launcher/me.js',
		'api/autopilot/proposals.js',
		'api/autopilot/config.js',
		'api/pump/[action].js',
	];

	for (const rel of ROUTES) {
		it(rel, () => {
			const src = readFileSync(path.join(ROOT, rel), 'utf8');
			expect(src).toMatch(/import \{ assertBearerMaySpend \} from '[./]*_lib\/spend-scope\.js'/);
			expect(src.match(/assertBearerMaySpend\(/g)?.length || 0).toBeGreaterThanOrEqual(1);
		});
	}

	it('the trade and withdraw executors check scope only once the request is known to spend', () => {
		const trade = readFileSync(path.join(ROOT, 'api/agents/solana-trade.js'), 'utf8');
		expect(trade).toMatch(/if \(!parsed\.preview\) assertBearerMaySpend\(auth\.bearer, req\)/);
		const wallet = readFileSync(path.join(ROOT, 'api/agents/solana-wallet.js'), 'utf8');
		expect(wallet).toMatch(/if \(!simulate\) assertBearerMaySpend\(auth\.bearer, req\)/);
	});
});
