import { describe, it, expect, vi } from 'vitest';

// Mock db.js to prevent DB connection on import
vi.mock('../../api/_lib/db.js', () => ({ sql: vi.fn() }));

import {
	defaultEmbedPolicy,
	normalizeLegacyPolicy,
	validateEmbedPolicy,
	POLICY_VERSION,
} from '../../api/_lib/embed-policy.js';

describe('defaultEmbedPolicy', () => {
	it('returns a policy with version 1', () => {
		const p = defaultEmbedPolicy();
		expect(p.version).toBe(1);
		expect(p.version).toBe(POLICY_VERSION);
	});

	it('has allowlist mode with empty hosts', () => {
		const p = defaultEmbedPolicy();
		expect(p.origins.mode).toBe('allowlist');
		expect(p.origins.hosts).toEqual([]);
	});

	it('has all surfaces enabled except mcp', () => {
		const p = defaultEmbedPolicy();
		expect(p.surfaces.script).toBe(true);
		expect(p.surfaces.iframe).toBe(true);
		expect(p.surfaces.widget).toBe(true);
		expect(p.surfaces.mcp).toBe(false);
	});

	it('brain defaults to we-pay mode', () => {
		const p = defaultEmbedPolicy();
		expect(p.brain.mode).toBe('we-pay');
		expect(p.brain.proxy_url).toBeNull();
		expect(p.brain.monthly_quota).toBe(1000);
		expect(p.brain.rate_limit_per_min).toBe(10);
	});

	it('storage defaults to r2', () => {
		const p = defaultEmbedPolicy();
		expect(p.storage.primary).toBe('r2');
		expect(p.storage.pinned_ipfs).toBe(false);
		expect(p.storage.onchain_attested).toBe(false);
	});
});

describe('normalizeLegacyPolicy', () => {
	it('returns default policy for null input', () => {
		const result = normalizeLegacyPolicy(null);
		expect(result).toEqual(defaultEmbedPolicy());
	});

	it('returns default policy for undefined input', () => {
		const result = normalizeLegacyPolicy(undefined);
		expect(result).toEqual(defaultEmbedPolicy());
	});

	it('handles legacy format (has mode/hosts at root, no version/origins)', () => {
		const legacy = { mode: 'denylist', hosts: ['evil.com', 'bad.io'] };
		const result = normalizeLegacyPolicy(legacy);
		expect(result.origins.mode).toBe('denylist');
		expect(result.origins.hosts).toEqual(['evil.com', 'bad.io']);
		expect(result.version).toBe(POLICY_VERSION);
		// surfaces/brain/storage should come from defaults
		expect(result.surfaces).toEqual(defaultEmbedPolicy().surfaces);
	});

	it('merges partial origins into defaults', () => {
		const partial = { origins: { mode: 'denylist', hosts: ['x.com'] } };
		const result = normalizeLegacyPolicy(partial);
		expect(result.origins.mode).toBe('denylist');
		expect(result.origins.hosts).toEqual(['x.com']);
	});

	it('merges partial surfaces into defaults', () => {
		const partial = { surfaces: { mcp: true } };
		const result = normalizeLegacyPolicy(partial);
		expect(result.surfaces.mcp).toBe(true);
		expect(result.surfaces.iframe).toBe(true); // from default
	});

	it('merges partial brain config into defaults', () => {
		const partial = { brain: { mode: 'none' } };
		const result = normalizeLegacyPolicy(partial);
		expect(result.brain.mode).toBe('none');
		expect(result.brain.monthly_quota).toBe(1000); // from default
	});
});

describe('validateEmbedPolicy', () => {
	it('accepts a valid full policy', () => {
		const policy = {
			origins: { mode: 'allowlist', hosts: ['example.com'] },
			surfaces: { script: true, iframe: false, widget: true, mcp: false },
			brain: {
				mode: 'we-pay',
				proxy_url: null,
				monthly_quota: 500,
				rate_limit_per_min: 5,
				model: 'claude-sonnet-4-6',
			},
			storage: { primary: 'r2', pinned_ipfs: false, onchain_attested: false },
		};
		const result = validateEmbedPolicy(policy);
		expect(result.origins.mode).toBe('allowlist');
		expect(result.origins.hosts).toEqual(['example.com']);
	});

	it('requires proxy_url when brain.mode is key-proxy', () => {
		const policy = {
			origins: { mode: 'allowlist', hosts: [] },
			surfaces: { script: true, iframe: true, widget: true, mcp: false },
			brain: {
				mode: 'key-proxy',
				proxy_url: null, // invalid — key-proxy needs a URL
				monthly_quota: null,
				rate_limit_per_min: null,
				model: 'claude-sonnet-4-6',
			},
			storage: { primary: 'r2', pinned_ipfs: false, onchain_attested: false },
		};
		expect(() => validateEmbedPolicy(policy)).toThrow();
	});

	it('accepts key-proxy with valid proxy_url', () => {
		const policy = {
			origins: { mode: 'allowlist', hosts: [] },
			surfaces: { script: true, iframe: true, widget: true, mcp: false },
			brain: {
				mode: 'key-proxy',
				proxy_url: 'https://proxy.example.com',
				monthly_quota: null,
				rate_limit_per_min: null,
				model: 'claude-sonnet-4-6',
			},
			storage: { primary: 'r2', pinned_ipfs: false, onchain_attested: false },
		};
		const result = validateEmbedPolicy(policy);
		expect(result.brain.mode).toBe('key-proxy');
	});

	it('rejects invalid origin mode', () => {
		const policy = {
			origins: { mode: 'wildcard', hosts: [] }, // invalid
			surfaces: { script: true, iframe: true, widget: true, mcp: false },
			brain: {
				mode: 'we-pay',
				proxy_url: null,
				monthly_quota: null,
				rate_limit_per_min: null,
				model: 'claude-sonnet-4-6',
			},
			storage: { primary: 'r2', pinned_ipfs: false, onchain_attested: false },
		};
		expect(() => validateEmbedPolicy(policy)).toThrow();
	});

	it('rejects more than 100 hosts', () => {
		const policy = {
			origins: {
				mode: 'allowlist',
				hosts: Array.from({ length: 101 }, (_, i) => `host${i}.com`),
			},
			surfaces: { script: true, iframe: true, widget: true, mcp: false },
			brain: {
				mode: 'we-pay',
				proxy_url: null,
				monthly_quota: null,
				rate_limit_per_min: null,
				model: 'claude-sonnet-4-6',
			},
			storage: { primary: 'r2', pinned_ipfs: false, onchain_attested: false },
		};
		expect(() => validateEmbedPolicy(policy)).toThrow();
	});
});
