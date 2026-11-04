import { describe, it, expect } from 'vitest';
import { parseArgs, parseTestCount, discoverPackages, probeChain, explorerChallenged, siblingDeps, PROBES } from '../scripts/verify-robinhood-repos.mjs';

describe('verify-robinhood-repos', () => {
	it('discovers all 17 Robinhood Chain packages with their scripts', () => {
		const pkgs = discoverPackages();
		expect(pkgs).toHaveLength(17);
		expect(pkgs.map((p) => p.name)).toContain('robinhood-chain-sdk');
		expect(pkgs.every((p) => p.hasLock)).toBe(true);
	});

	it('parses flags and rejects unknown ones', () => {
		expect(parseArgs(['--jobs', '4', '--only', 'hood-js,hood-cli', '--skip-probe', '--json'])).toMatchObject({
			jobs: 4,
			only: ['hood-js', 'hood-cli'],
			probe: false,
			json: true,
			install: true,
		});
		expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
		expect(() => parseArgs(['--jobs', '0'])).toThrow(/positive integer/);
	});

	it('reads the passed count from vitest and node:test output', () => {
		expect(parseTestCount(' Test Files  3 passed (3)\n      Tests  22 passed (22)')).toBe(22);
		expect(parseTestCount('# tests 9\n# pass 9\n# fail 0')).toBe(9);
		expect(parseTestCount('\u001b[2m      Tests  \u001b[22m \u001b[1m\u001b[32m26 passed\u001b[39m')).toBe(26);
		expect(parseTestCount('\u2139 tests 9\n\u2139 pass 9\n\u2139 fail 0')).toBe(9);
		expect(parseTestCount('no summary here')).toBeNull();
	});

	it('probes pin the documented chain ids', () => {
		expect(PROBES.map((p) => p.chainId)).toEqual([4663, 46630]);
	});

	it('probeChain accepts a matching chain id and reports a mismatch or HTTP error', async () => {
		const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
		expect(await probeChain(PROBES[0], reply(200, { result: '0x1237' }))).toMatchObject({ ok: true });
		expect(await probeChain(PROBES[0], reply(200, { result: '0x1' }))).toMatchObject({ ok: false });
		expect(await probeChain(PROBES[0], reply(503, {}))).toMatchObject({ ok: false, detail: 'HTTP 503' });
		expect(await probeChain(PROBES[0], async () => { throw new Error('offline'); })).toMatchObject({ ok: false, detail: 'offline' });
	});

	it('finds sibling file: dependencies so dependents verify after their dependency', () => {
		expect(siblingDeps({ devDependencies: { hoodchain: 'file:../robinhood-chain-sdk' }, dependencies: { x: '^1.0.0' } })).toEqual(['robinhood-chain-sdk']);
		const byName = Object.fromEntries(discoverPackages().map((p) => [p.name, p.siblings]));
		expect(byName['hood-js']).toContain('robinhood-chain-sdk');
		expect(byName['hood-pay']).toContain('hood-connect');
	});

	it('explorerChallenged is true only for a Cloudflare managed challenge', async () => {
		const withHeader = (v) => async () => ({ headers: { get: () => v } });
		expect(await explorerChallenged(withHeader('challenge'))).toBe(true);
		expect(await explorerChallenged(withHeader(null))).toBe(false);
		expect(await explorerChallenged(async () => { throw new Error('offline'); })).toBe(false);
	});
});
