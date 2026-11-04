import { describe, it, expect, vi } from 'vitest';
import { SkillRegistry } from '../src/skills/index.js';

const ORIGIN = 'https://skills.example.com';

function bundleFetch(author) {
	return vi.fn(async (url) => {
		const u = String(url);
		const ok = (body) => ({
			ok: true,
			status: 200,
			json: async () => body,
			text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
		});
		if (u.endsWith('manifest.json')) return ok({ name: 'demo', version: '1.0.0', author });
		if (u.endsWith('tools.json')) return ok({ tools: [] });
		if (u.endsWith('SKILL.md')) return ok('demo skill');
		return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
	});
}

const spec = { uri: `${ORIGIN}/bundles/demo/` };

describe('SkillRegistry whitelist trust', () => {
	it('admits a bundle whose author is listed (case-insensitive)', async () => {
		const reg = new SkillRegistry({
			fetchFn: bundleFetch('0xABC'),
			trust: 'whitelist',
			trustedAuthors: ['0xabc'],
		});
		await expect(reg.install(spec)).resolves.toBeTruthy();
	});

	it('admits a bundle served from a listed origin', async () => {
		const reg = new SkillRegistry({
			fetchFn: bundleFetch('0xother'),
			trust: 'whitelist',
			trustedOrigins: [ORIGIN],
		});
		await expect(reg.install(spec)).resolves.toBeTruthy();
	});

	it('rejects an author and origin that are not listed', async () => {
		const reg = new SkillRegistry({
			fetchFn: bundleFetch('0xevil'),
			trust: 'whitelist',
			trustedAuthors: ['0xabc'],
			trustedOrigins: ['https://other.example.com'],
		});
		await expect(reg.install(spec)).rejects.toThrow(/not on the whitelist/);
	});

	it('rejects everything when both lists are empty', async () => {
		const reg = new SkillRegistry({ fetchFn: bundleFetch('0xabc'), trust: 'whitelist' });
		await expect(reg.install(spec)).rejects.toThrow(/not on the whitelist/);
	});
});

describe('element skill allowlist wiring', () => {
	const fakeEl = (attrs = {}, skillTrust) => ({
		getAttribute: (n) => (n in attrs ? attrs[n] : null),
		skillTrust,
	});

	it('reads comma separated attributes, lowercased and trimmed', async () => {
		const { buildSkillRegistry } = await import('../src/skills/registry-config.js');
		const reg = buildSkillRegistry(
			fakeEl({
				'skill-trust': 'whitelist',
				'skill-trusted-authors': ' 0xABC , 0xDef ',
				'skill-trusted-origins': `${ORIGIN}/ignored/path, https://b.example.com`,
			}),
			{},
			[],
			{ warn: () => {} },
		);
		expect(reg.trust).toBe('whitelist');
		expect([...reg.trustedAuthors]).toEqual(['0xabc', '0xdef']);
		expect([...reg.trustedOrigins]).toEqual([ORIGIN, 'https://b.example.com']);
	});

	it('merges the skillTrust property', async () => {
		const { buildSkillRegistry } = await import('../src/skills/registry-config.js');
		const reg = buildSkillRegistry(
			fakeEl({ 'skill-trust': 'whitelist' }, { authors: ['0xAA'], origins: [ORIGIN] }),
			{},
			[],
			{ warn: () => {} },
		);
		expect([...reg.trustedAuthors]).toEqual(['0xaa']);
		expect([...reg.trustedOrigins]).toEqual([ORIGIN]);
	});

	it('ignores invalid origins with a warning and defaults to owned-only', async () => {
		const { buildSkillRegistry } = await import('../src/skills/registry-config.js');
		const warn = vi.fn();
		const reg = buildSkillRegistry(
			fakeEl({ 'skill-trusted-origins': 'not a url, ftp://x.example.com' }),
			{ id: { owner: '0xOwner' } },
			[],
			{ warn },
		);
		expect(reg.trust).toBe('owned-only');
		expect(reg.trustedOrigins.size).toBe(0);
		expect(warn).toHaveBeenCalledTimes(2);
	});
});

describe('element skill trust mode', () => {
	const fakeEl = (attrs = {}, skillTrust) => ({
		getAttribute: (n) => (n in attrs ? attrs[n] : null),
		skillTrust,
	});

	it('an unknown mode used to install every bundle unchecked', async () => {
		// The registry enforces only the modes it knows, which is why the element
		// must never hand it a raw attribute value.
		const reg = new SkillRegistry({ fetchFn: bundleFetch('0xevil'), trust: 'whitelsit', ownerAddress: '0xowner' });
		await expect(reg.install(spec)).resolves.toBeTruthy();
	});

	it('falls back to owned-only on an unknown mode and refuses a foreign author', async () => {
		const { buildSkillRegistry } = await import('../src/skills/registry-config.js');
		const warn = vi.fn();
		const reg = buildSkillRegistry(fakeEl({ 'skill-trust': 'whitelsit' }), { id: { owner: '0xOwner' } }, [], { warn });
		expect(reg.trust).toBe('owned-only');
		expect(warn).toHaveBeenCalledTimes(1);
		reg.fetchFn = bundleFetch('0xevil');
		await expect(reg.install(spec)).rejects.toThrow(/not trusted under owned-only/);
	});

	it('accepts the mode case-insensitively', async () => {
		const { buildSkillRegistry } = await import('../src/skills/registry-config.js');
		const reg = buildSkillRegistry(fakeEl({ 'skill-trust': ' Whitelist ' }), {}, [], { warn: () => {} });
		expect(reg.trust).toBe('whitelist');
	});

	it('installs from a listed author and refuses an unlisted one through the built registry', async () => {
		const { buildSkillRegistry } = await import('../src/skills/registry-config.js');
		const el = fakeEl({ 'skill-trust': 'whitelist', 'skill-trusted-authors': '0xABC' });
		const listed = buildSkillRegistry(el, {}, [], { warn: () => {} });
		listed.fetchFn = bundleFetch('0xabc');
		await expect(listed.install(spec)).resolves.toBeTruthy();

		const unlisted = buildSkillRegistry(el, {}, [], { warn: () => {} });
		unlisted.fetchFn = bundleFetch('0xdef');
		await expect(unlisted.install(spec)).rejects.toThrow(/not on the whitelist/);
	});

	it('re-applies a changed policy to an existing registry', async () => {
		const { buildSkillRegistry, applySkillTrust } = await import('../src/skills/registry-config.js');
		const attrs = { 'skill-trust': 'whitelist' };
		const el = fakeEl(attrs);
		const reg = buildSkillRegistry(el, {}, [], { warn: () => {} });
		reg.fetchFn = bundleFetch('0xabc');
		await expect(reg.install(spec)).rejects.toThrow(/not on the whitelist/);

		attrs['skill-trusted-origins'] = ORIGIN;
		applySkillTrust(reg, el, { warn: () => {} });
		await expect(reg.install(spec)).resolves.toBeTruthy();
	});
});
