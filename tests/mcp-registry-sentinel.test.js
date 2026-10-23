// Unit tests for the MCP registry sentinel: one case per finding type, the
// change-detection that gates alerts, and registry cursor pagination.

import { describe, it, expect, vi } from 'vitest';
import {
	diffRegistry,
	findingKeys,
	changedSince,
	compareSemver,
	alertDetail,
} from '../api/_lib/mcp-registry-sentinel.js';
import { fetchRegistryLatest } from '../api/cron/mcp-registry-sentinel.js';

const REPO = 'https://github.com/nirholas/three.ws';
const local = [
	{ name: 'io.github.nirholas/solana-memo-media-mcp', version: '0.1.0', repoUrl: REPO, dir: 'packages/solana-memo-media-mcp', npm: { identifier: '@three-ws/solana-memo-media-mcp', version: '0.1.0' } },
	{ name: 'io.github.nirholas/kol-mcp', version: '0.1.3', repoUrl: REPO, dir: 'packages/kol-mcp', npm: { identifier: '@three-ws/kol-mcp', version: '0.1.3' } },
	{ name: 'io.github.nirholas/moved-mcp', version: '1.0.0', repoUrl: REPO, dir: 'packages/moved-mcp' },
	{ name: 'io.github.nirholas/three.ws', version: '1.0.1', repoUrl: REPO, dir: '.' },
];
const registry = [
	{ name: 'io.github.nirholas/kol-mcp', version: '0.1.2', repoUrl: REPO },
	{ name: 'io.github.nirholas/moved-mcp', version: '1.0.0', repoUrl: 'https://github.com/nirholas/gone.git' },
	{ name: 'io.github.nirholas/three.ws', version: '1.0.1', repoUrl: `${REPO}.git` },
	{ name: 'io.github.nirholas/orphan-mcp', version: '2.0.0', repoUrl: REPO },
];
const npmLatest = { '@three-ws/solana-memo-media-mcp': null, '@three-ws/kol-mcp': '0.1.2' };
const remotes = [
	{ name: 'io.github.nirholas/three.ws', url: 'https://three.ws/api/mcp', ok: true, status: 200 },
	{ name: 'io.github.nirholas/kol-mcp', url: 'https://example.invalid/mcp', ok: false },
];

describe('diffRegistry', () => {
	const diff = diffRegistry({ local, registry, npmLatest, remotes });

	it('lists a local server missing from the registry as unpublished', () => {
		expect(diff.unpublished.map((f) => f.name)).toEqual(['io.github.nirholas/solana-memo-media-mcp']);
	});
	it('flags a local version newer than the registry as behind', () => {
		expect(diff.behind).toEqual([{ name: 'io.github.nirholas/kol-mcp', local: '0.1.3', registry: '0.1.2' }]);
	});
	it('flags a repository URL mismatch and ignores a trailing .git', () => {
		expect(diff.repoMismatch.map((f) => f.name)).toEqual(['io.github.nirholas/moved-mcp']);
	});
	it('lists registry names with no local manifest', () => {
		expect(diff.registryOnly.map((f) => f.name)).toEqual(['io.github.nirholas/orphan-mcp']);
	});
	it('flags npm missing or older than the local package version', () => {
		expect(diff.npmBehind.map((f) => [f.package, f.npm])).toEqual([
			['@three-ws/kol-mcp', '0.1.2'],
			['@three-ws/solana-memo-media-mcp', null],
		]);
	});
	it('flags an unreachable hosted remote', () => {
		expect(diff.remoteDown).toEqual([{ name: 'io.github.nirholas/kol-mcp', url: 'https://example.invalid/mcp', status: null }]);
	});
	it('reports nothing for a fully published, in-sync server', () => {
		const clean = diffRegistry({ local: [local[3]], registry: [registry[2]], npmLatest: {}, remotes: [remotes[0]] });
		expect(findingKeys(clean)).toEqual([]);
	});
});

describe('changedSince', () => {
	it('alerts only on new keys and reports resolved ones', () => {
		expect(changedSince(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], resolved: ['a'] });
		expect(changedSince(['a'], ['a'])).toEqual({ added: [], resolved: [] });
	});
	it('treats a first run as all-new', () => {
		expect(changedSince(null, ['a']).added).toEqual(['a']);
	});
	it('limits alert text to added findings', () => {
		const diff = diffRegistry({ local, registry, npmLatest, remotes });
		const text = alertDetail(diff, ['unpublished:io.github.nirholas/solana-memo-media-mcp']);
		expect(text).toContain('solana-memo-media-mcp');
		expect(text).not.toContain('orphan');
	});
});

describe('compareSemver', () => {
	it('orders numerically, not lexically', () => {
		expect(compareSemver('0.10.0', '0.9.0')).toBe(1);
		expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
		expect(compareSemver('x', '1.0.0')).toBe(0);
	});
});

describe('fetchRegistryLatest', () => {
	const entry = (name, extra = {}) => ({ server: { name, version: '1.0.0', repository: { url: REPO } }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true, ...extra } } });
	it('follows nextCursor until empty and skips foreign namespaces and non-latest rows', async () => {
		const pages = [
			{ servers: [entry('io.github.nirholas/a'), entry('io.github.other/x')], metadata: { nextCursor: 'c1' } },
			{ servers: [entry('io.github.nirholas/b'), entry('io.github.nirholas/old', { isLatest: false })], metadata: {} },
		];
		const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => pages.shift() }));
		const out = await fetchRegistryLatest(fetchImpl);
		expect(out.map((e) => e.name)).toEqual(['io.github.nirholas/a', 'io.github.nirholas/b']);
		expect(fetchImpl.mock.calls[1][0]).toContain('cursor=c1');
	});
});
