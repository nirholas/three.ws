/**
 * Contract test for pump-fun MCP read-tool response shapes that the
 * compose loops depend on. Mocks the MCP endpoint and asserts that
 * realistic JSON-RPC responses parse into the fields the loops consume:
 *   - searchTokens     → results[].mint
 *   - getNewTokens     → tokens[].mint
 *   - getTokenHolders  → topHolderPct OR holders[].pct
 *   - getCreatorProfile→ rugCount + tokens[].mint
 *   - getTokenDetails  → creator
 *   - getTokenTrades   → trades[] with side/wallet/sig/solAmount/pctOfSupply
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerPumpFunComposeSkills } from '../../src/agent-skills-pumpfun-compose.js';

function jsonRpc(payload) {
	return {
		ok: true,
		json: async () => ({
			jsonrpc: '2.0',
			id: 1,
			result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
		}),
	};
}

function makeSkills() {
	const map = new Map();
	const performed = [];
	return {
		register: (def) => map.set(def.name, def),
		get: (n) => map.get(n),
		perform: vi.fn(async (name, args) => {
			performed.push({ name, args });
			if (name === 'pumpfun-buy') return { success: true, data: { signature: `sig:${args.mint}:${args.solAmount}` } };
			if (name === 'pumpfun-sell') return { success: true, data: { signature: `sell:${args.mint}` } };
			if (name === 'pumpfun-status') return { success: true, data: { userBalance: '12345' } };
			return { success: false };
		}),
		_performed: performed,
	};
}

describe('pump-fun compose ↔ MCP contract', () => {
	const fetchMock = vi.fn();
	beforeEach(() => {
		fetchMock.mockReset();
		globalThis.fetch = fetchMock;
	});

	it('researchAndBuy: parses searchTokens.results[].mint and routes to pumpfun-buy', async () => {
		const skills = makeSkills();
		registerPumpFunComposeSkills(skills);
		const skill = skills.get('pumpfun-research-and-buy');

		fetchMock.mockResolvedValueOnce(jsonRpc({ results: [{ mint: 'MINT1' }] })); // searchTokens
		fetchMock.mockResolvedValueOnce(jsonRpc({ creator: 'CREATOR1' })); // getTokenDetails
		fetchMock.mockResolvedValueOnce(jsonRpc({ total: 100, topHolderPct: 10 })); // getTokenHolders
		fetchMock.mockResolvedValueOnce(jsonRpc({ rugCount: 0, tokens: [] })); // getCreatorProfile

		const r = await skill.handler({ query: 'foo', amountSol: 0.1 }, {});
		expect(r.success).toBe(true);
		expect(r.data.decision).toBe('buy');
		expect(r.data.mint).toBe('MINT1');
		expect(skills._performed).toContainEqual({ name: 'pumpfun-buy', args: { mint: 'MINT1', solAmount: 0.1 } });
	});

	it('researchAndBuy with dryRun:true skips signing but still vets', async () => {
		const skills = makeSkills();
		registerPumpFunComposeSkills(skills);
		const skill = skills.get('pumpfun-research-and-buy');

		fetchMock.mockResolvedValueOnce(jsonRpc({ results: [{ mint: 'MINT2' }] }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ creator: 'CREATOR2' }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ total: 100, topHolderPct: 5 }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ rugCount: 0 }));

		const r = await skill.handler({ query: 'bar', amountSol: 0.05, dryRun: true }, {});
		expect(r.data.decision).toBe('buy');
		expect(r.data.dryRun).toBe(true);
		expect(r.data.sig).toBe(null);
		expect(skills.perform).not.toHaveBeenCalledWith('pumpfun-buy', expect.anything(), expect.anything());
	});

	it('filters reject high top-holder concentration', async () => {
		const skills = makeSkills();
		registerPumpFunComposeSkills(skills);
		const skill = skills.get('pumpfun-research-and-buy');

		fetchMock.mockResolvedValueOnce(jsonRpc({ results: [{ mint: 'WHALE' }] }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ creator: 'C' }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ total: 100, topHolderPct: 80 }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ rugCount: 0 }));

		const r = await skill.handler({ query: 'x' }, {});
		expect(r.data.decision).toBe('skip');
		expect(r.data.reason).toMatch(/top holder owns 80/);
	});

	it('filters reject creator with prior rugs', async () => {
		const skills = makeSkills();
		registerPumpFunComposeSkills(skills);
		const skill = skills.get('pumpfun-research-and-buy');

		fetchMock.mockResolvedValueOnce(jsonRpc({ results: [{ mint: 'RUGGED' }] }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ creator: 'BAD' }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ total: 100, topHolderPct: 5 }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ rugFlags: ['x', 'y', 'z'] })); // rugFlags fallback path

		const r = await skill.handler({ query: 'x' }, {});
		expect(r.data.decision).toBe('skip');
		expect(r.data.reason).toMatch(/3 prior rug/);
	});

	it('rugExitWatch sells when top holder crosses concentration threshold', async () => {
		const skills = makeSkills();
		registerPumpFunComposeSkills(skills);
		const skill = skills.get('pumpfun-rug-exit-watch');

		fetchMock.mockResolvedValueOnce(jsonRpc({ topHolderPct: 60 })); // holders
		fetchMock.mockResolvedValueOnce(jsonRpc({ trades: [] })); // trades
		fetchMock.mockResolvedValueOnce(jsonRpc({ creator: 'DEV' })); // details

		const r = await skill.handler({ mints: ['MINT_X'], durationSec: 1, dryRun: false }, { skillConfig: { pollMs: 0 } });
		expect(r.data.exited).toEqual(['MINT_X']);
		expect(r.data.events[0].trigger).toMatch(/top holder 60/);
		expect(skills.perform).toHaveBeenCalledWith('pumpfun-sell', { mint: 'MINT_X', tokenAmount: '12345' }, expect.anything());
	});

	it('rugExitWatch sells when dev sells exceed devSell threshold', async () => {
		const skills = makeSkills();
		registerPumpFunComposeSkills(skills);
		const skill = skills.get('pumpfun-rug-exit-watch');

		fetchMock.mockResolvedValueOnce(jsonRpc({ topHolderPct: 5 }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ trades: [{ side: 'sell', wallet: 'DEV', pctOfSupply: 30 }] }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ creator: 'DEV' }));

		const r = await skill.handler({ mints: ['MINT_Y'], durationSec: 1 }, { skillConfig: { pollMs: 0 } });
		expect(r.data.exited).toEqual(['MINT_Y']);
		expect(r.data.events[0].trigger).toMatch(/dev sold 30/);
	});

	it('sessionId persists spent across two autoSnipe runs (no double-spend)', async () => {
		const skills = makeSkills();
		registerPumpFunComposeSkills(skills);
		const snipe = skills.get('pumpfun-auto-snipe');

		const memoryEntries = [];
		const ctx = {
			memory: {
				add: (e) => memoryEntries.push(e),
				query: ({ tags }) => memoryEntries.filter((m) => (m.tags || []).some((t) => tags.includes(t))).slice(-1),
			},
			skillConfig: { sessionSpendCapSol: 0.05, perTradeSol: 0.05, pollMs: 0 },
		};

		// Run 1: 1 fresh token, 1 buy → spent = 0.05, then cap blocks further loops
		fetchMock.mockResolvedValueOnce(jsonRpc({ tokens: [{ mint: 'A' }] }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ creator: 'CA' })); // details
		fetchMock.mockResolvedValueOnce(jsonRpc({ total: 100, topHolderPct: 5 })); // holders
		fetchMock.mockResolvedValueOnce(jsonRpc({ rugCount: 0 })); // creator

		const r1 = await snipe.handler({ durationSec: 1, sessionId: 'S1' }, ctx);
		expect(r1.data.spent).toBe(0.05);

		// Run 2: same sessionId, fresh cap. State should restore — A is in `seen`,
		// won't re-buy even though the cap would otherwise allow it.
		ctx.skillConfig.sessionSpendCapSol = 0.5;
		fetchMock.mockResolvedValueOnce(jsonRpc({ tokens: [{ mint: 'A' }] }));
		const r2 = await snipe.handler({ durationSec: 1, sessionId: 'S1' }, ctx);
		expect(r2.data.spent).toBe(0.05); // unchanged — A was already seen
	});

	it('rugExitWatch skips (no `exited` mark) when userBalance is 0', async () => {
		const skills = makeSkills();
		// Override pumpfun-status to return zero balance
		skills.perform = vi.fn(async (name) => {
			if (name === 'pumpfun-status') return { success: true, data: { userBalance: '0' } };
			return { success: false };
		});
		registerPumpFunComposeSkills(skills);
		const skill = skills.get('pumpfun-rug-exit-watch');

		fetchMock.mockResolvedValueOnce(jsonRpc({ topHolderPct: 60 }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ trades: [] }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ creator: 'DEV' }));

		const r = await skill.handler(
			{ mints: ['MINT_Z'], durationSec: 1, dryRun: false },
			{ skillConfig: { pollMs: 0 } },
		);
		expect(r.data.exited).toEqual([]); // not marked as exited — we never owned it
		expect(r.data.events[0].action).toBe('skipped-no-balance');
		expect(skills.perform).not.toHaveBeenCalledWith('pumpfun-sell', expect.anything(), expect.anything());
	});

	it('autoSnipe aborts promptly via signal', async () => {
		const skills = makeSkills();
		registerPumpFunComposeSkills(skills);
		const snipe = skills.get('pumpfun-auto-snipe');
		const ctrl = new AbortController();

		// Pre-abort the signal — loop should bail before any MCP call.
		ctrl.abort();
		const start = Date.now();
		const r = await snipe.handler(
			{ durationSec: 60, signal: ctrl.signal },
			{ skillConfig: { pollMs: 100, perTradeSol: 0.05, sessionSpendCapSol: 1 } },
		);
		expect(Date.now() - start).toBeLessThan(200); // would otherwise wait pollMs+
		expect(r.data.reason).toBe('aborted');
	});

	it('compose progress events fire on every state change', async () => {
		const skills = makeSkills();
		registerPumpFunComposeSkills(skills);
		const skill = skills.get('pumpfun-research-and-buy');

		fetchMock.mockResolvedValueOnce(jsonRpc({ results: [{ mint: 'MINT3' }] }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ creator: 'C3' }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ total: 100, topHolderPct: 5 }));
		fetchMock.mockResolvedValueOnce(jsonRpc({ rugCount: 0 }));

		const events = [];
		const onProgress = (e) => events.push(e.type);
		await skill.handler({ query: 'foo', dryRun: true, onProgress }, {});
		expect(events).toContain('search');
		expect(events).toContain('vet');
		expect(events).toContain('dry-buy');
	});
});
