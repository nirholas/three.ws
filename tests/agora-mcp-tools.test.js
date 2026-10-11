/**
 * Agora MCP tools (Task 10) — surface + read-tool behavior, under vitest so the
 * root `npm test` covers the MCP the way Task 11 requires. The package also ships
 * node:test suites (packages/agora-mcp/test/*.test.mjs) for the write-tool
 * early-reject paths; this suite complements them with:
 *
 *   1. the tool-surface contract for ALL eleven tools (name/title/description/
 *      inputSchema/handler + read-only vs write annotations), and
 *   2. the READ tools' real shaping/filtering logic, driven with `apiRequest`
 *      mocked at the HTTP boundary (never a mock in shipped code) so profession /
 *      minReward filtering, the additive bit-value derivation, and the passport
 *      404→not_found mapping are pinned without a live economy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the single HTTP boundary the read tools call. Same absolute module the
// tools import via `../lib/api.js`, so the mock covers them.
vi.mock('../packages/agora-mcp/src/lib/api.js', () => ({
	apiRequest: vi.fn(),
}));

import { apiRequest } from '../packages/agora-mcp/src/lib/api.js';
import { TOOLS } from '../packages/agora-mcp/src/index.js';
import { def as board } from '../packages/agora-mcp/src/tools/board.js';
import { def as professions } from '../packages/agora-mcp/src/tools/professions.js';
import { def as passport } from '../packages/agora-mcp/src/tools/passport.js';
import { def as pulse } from '../packages/agora-mcp/src/tools/pulse.js';
import { def as citizens } from '../packages/agora-mcp/src/tools/citizens.js';

// agora_quote_register and agora_quote_task are the previews the spend tools
// (agora_register, agora_post_task) are gated on: read-only, nothing signed.
const READ_TOOLS = new Set([
	'agora_board', 'agora_pulse', 'agora_citizens', 'agora_passport', 'agora_professions',
	'agora_quote_register', 'agora_quote_task',
]);
const WRITE_TOOLS = new Set(['agora_register', 'agora_claim_task', 'agora_complete_task', 'agora_post_task']);

beforeEach(() => {
	vi.mocked(apiRequest).mockReset();
});

describe('tool surface: all eleven tools', () => {
	it('exposes exactly the expected tool names', () => {
		const names = TOOLS.map((t) => t.name).sort();
		expect(names).toEqual(
			[...READ_TOOLS, ...WRITE_TOOLS].sort(),
		);
	});

	it('every tool has a name, title, description, inputSchema and a handler', () => {
		for (const t of TOOLS) {
			expect(typeof t.name).toBe('string');
			expect(t.name).toMatch(/^agora_/);
			expect(typeof t.title).toBe('string');
			expect(t.title.length).toBeGreaterThan(0);
			expect(typeof t.description).toBe('string');
			expect(t.description.length).toBeGreaterThan(40);
			expect(t.inputSchema && typeof t.inputSchema).toBe('object');
			expect(typeof t.handler).toBe('function');
		}
	});

	it('read tools are annotated read-only; write tools are not', () => {
		for (const t of TOOLS) {
			if (READ_TOOLS.has(t.name)) expect(t.annotations?.readOnlyHint).toBe(true);
			if (WRITE_TOOLS.has(t.name)) expect(t.annotations?.readOnlyHint).not.toBe(true);
		}
	});

	it('promotes only $THREE — any coin ticker named in a description is $THREE', () => {
		for (const t of TOOLS) {
			// If a $TICKER appears at all, the only one allowed is $THREE (the promoted
			// coin). USDC may be named as a payment currency but never with a $ prefix.
			const tickers = t.description.match(/\$[A-Z]{2,6}\b/g) || [];
			for (const tk of tickers) expect(tk).toBe('$THREE');
		}
	});
});

describe('agora_board — profession + minReward filtering (read model boundary mocked)', () => {
	const sample = {
		ok: true,
		tasks: [
			{ source: 'agenc', profession: 'sculptor', reward: { amountAtomic: '1000000' }, taskPda: 'A' },
			{ source: 'agenc', profession: 'fetcher', reward: { amountAtomic: '10' }, taskPda: 'B' },
		],
		services: [
			{ source: 'x402', profession: 'fetcher', reward: { amountAtomic: '500' }, resource: 'https://x' },
			{ source: 'x402', profession: 'fetcher', reward: null, resource: 'https://y' },
		],
		errors: [{ source: 'x402', error: 'bazaar_down' }],
		fetchedAt: '2026-07-02T00:00:00.000Z',
	};

	it('filters both lanes by profession', async () => {
		vi.mocked(apiRequest).mockResolvedValue(sample);
		const out = await board.handler({ profession: 'fetcher' });
		expect(out.tasks.every((t) => t.profession === 'fetcher')).toBe(true);
		expect(out.services.every((s) => s.profession === 'fetcher')).toBe(true);
		expect(out.openTaskCount).toBe(1);
		expect(out.filters.profession).toBe('fetcher');
	});

	it('drops jobs below minReward (BigInt-compared) and rows with no reward', async () => {
		vi.mocked(apiRequest).mockResolvedValue(sample);
		const out = await board.handler({ minReward: '1000' });
		// sculptor 1_000_000 passes; fetcher 10 drops; service 500 drops; null-reward drops.
		expect(out.tasks.map((t) => t.taskPda)).toEqual(['A']);
		expect(out.services).toHaveLength(0);
		expect(out.filters.minReward).toBe('1000');
	});

	it('reports an honest empty board and passes upstream errors through', async () => {
		vi.mocked(apiRequest).mockResolvedValue({ ok: true, tasks: [], services: [], errors: [{ source: 'x402', error: 'down' }] });
		const out = await board.handler({});
		expect(out.empty).toBe(true);
		expect(out.errors).toEqual([{ source: 'x402', error: 'down' }]);
	});

	it('tolerates a malformed upstream (missing arrays) without throwing', async () => {
		vi.mocked(apiRequest).mockResolvedValue({ ok: true });
		const out = await board.handler({});
		expect(out.tasks).toEqual([]);
		expect(out.services).toEqual([]);
		expect(out.empty).toBe(true);
	});
});

describe('agora_professions — additive bit-value derivation', () => {
	it('derives bitValue = 1<<bit as a string for each profession', async () => {
		vi.mocked(apiRequest).mockResolvedValue({
			professions: [
				{ key: 'fetcher', label: 'Fetcher', bit: 0 },
				{ key: 'verifier', label: 'Verifier', bit: 6 },
			],
			fetchedAt: 't',
		});
		const out = await professions.handler({});
		expect(out.count).toBe(2);
		expect(out.professions[0].bitValue).toBe('1'); // 1<<0
		expect(out.professions[1].bitValue).toBe('64'); // 1<<6
	});

	it('returns an empty registry honestly when the read model has none', async () => {
		vi.mocked(apiRequest).mockResolvedValue({ professions: [] });
		const out = await professions.handler({});
		expect(out.count).toBe(0);
		expect(out.professions).toEqual([]);
	});
});

describe('agora_passport — selector validation + 404 mapping', () => {
	it('rejects with validation_error when no selector is supplied', async () => {
		await expect(passport.handler({})).rejects.toMatchObject({ code: 'validation_error' });
	});

	it('maps an upstream 404 to a soft not_found (never throws for an unknown citizen)', async () => {
		vi.mocked(apiRequest).mockRejectedValue(Object.assign(new Error('nope'), { code: 'upstream_error', status: 404 }));
		const out = await passport.handler({ id: 'ghost' });
		expect(out).toMatchObject({ ok: false, error: 'not_found', id: 'ghost' });
	});

	it('re-throws non-404 upstream errors (a real outage is not "not found")', async () => {
		vi.mocked(apiRequest).mockRejectedValue(Object.assign(new Error('boom'), { code: 'upstream_error', status: 503 }));
		await expect(passport.handler({ id: 'x' })).rejects.toThrow('boom');
	});

	it('shapes a found citizen with defensive activity fallback', async () => {
		vi.mocked(apiRequest).mockResolvedValue({ citizen: { id: 'c1' }, onchain: null, fetchedAt: 't' });
		const out = await passport.handler({ id: 'c1' });
		expect(out.ok).toBe(true);
		expect(out.citizen.id).toBe('c1');
		expect(out.activity).toEqual([]);
	});
});

describe('agora_pulse / agora_citizens — defensive shaping', () => {
	it('pulse passes the read model through and tolerates absence', async () => {
		vi.mocked(apiRequest).mockResolvedValue({ ok: true, population: { total: 0 }, empty: true });
		const out = await pulse.handler({});
		expect(out.ok).toBe(true);
	});

	it('citizens returns an array even on a malformed upstream', async () => {
		vi.mocked(apiRequest).mockResolvedValue({ ok: true });
		const out = await citizens.handler({});
		expect(Array.isArray(out.citizens)).toBe(true);
	});
});
