import { describe, expect, it, vi } from 'vitest';
import {
	detectPlatform,
	formatBytes,
	isUsableRelease,
	pickPrimary,
	planDownloads,
	readReleaseFeed,
	signingSummary,
} from '../src/forge-desktop-release.js';

const SHA = 'a'.repeat(64);
const file = (platform, kind, primary = false) => ({
	platform,
	arch: platform === 'mac' ? 'arm64' : 'x64',
	kind,
	label: kind,
	primary,
	name: `three.ws-Forge-0.5.0-${platform}.${kind}`,
	url: `https://three.ws/releases/forge/0.5.0/three.ws-Forge-0.5.0-${platform}.${kind}`,
	size: 210_000_000,
	sha256: SHA,
	signed: false,
});

const FILES = [file('mac', 'zip'), file('mac', 'dmg', true), file('win', 'portable'), file('win', 'nsis', true), file('linux', 'deb'), file('linux', 'appimage', true)];

describe('detectPlatform', () => {
	it('prefers client hints', () => {
		expect(detectPlatform({ userAgentData: { platform: 'macOS', mobile: false }, userAgent: 'Windows NT' })).toBe('mac');
		expect(detectPlatform({ userAgentData: { platform: 'Windows', mobile: false } })).toBe('win');
		expect(detectPlatform({ userAgentData: { platform: 'Linux', mobile: false } })).toBe('linux');
		expect(detectPlatform({ userAgentData: { platform: 'Android', mobile: true } })).toBe('other');
		expect(detectPlatform({ userAgentData: { platform: 'Chrome OS', mobile: false } })).toBe('other');
	});

	it('falls back to the user agent string', () => {
		expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/131.0' })).toBe('win');
		expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15', maxTouchPoints: 0 })).toBe('mac');
		expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0' })).toBe('linux');
	});

	it('treats phones, tablets, iPadOS and ChromeOS as other', () => {
		expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36' })).toBe('other');
		expect(detectPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' })).toBe('other');
		expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 })).toBe('other');
		expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 15917.0.0) Chrome/129.0' })).toBe('other');
	});
});

describe('pickPrimary', () => {
	it('offers each platform its primary artifact', () => {
		expect(pickPrimary(FILES, 'mac').kind).toBe('dmg');
		expect(pickPrimary(FILES, 'win').kind).toBe('nsis');
		expect(pickPrimary(FILES, 'linux').kind).toBe('appimage');
	});

	it('falls back to any file for the platform, and to nothing for other', () => {
		expect(pickPrimary([file('linux', 'deb')], 'linux').kind).toBe('deb');
		expect(pickPrimary(FILES, 'other')).toBeNull();
		expect(pickPrimary([file('win', 'nsis', true)], 'mac')).toBeNull();
	});
});

describe('formatBytes', () => {
	it('prints human sizes', () => {
		expect(formatBytes(0)).toBe('');
		expect(formatBytes(500)).toBe('1 KB');
		expect(formatBytes(52 * 1024 * 1024)).toBe('52.0 MB');
		expect(formatBytes(210_000_000)).toBe('200 MB');
		expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB');
	});
});

describe('isUsableRelease', () => {
	it('accepts a release.json the pipeline writes', () => {
		expect(isUsableRelease({ schema: 1, version: '0.5.0', files: FILES })).toBe(true);
	});

	it('rejects empty, malformed or unsafe feeds', () => {
		expect(isUsableRelease(null)).toBe(false);
		expect(isUsableRelease({ version: '0.5.0', files: [] })).toBe(false);
		expect(isUsableRelease({ files: FILES })).toBe(false);
		expect(isUsableRelease({ version: '0.5.0', files: [{ ...FILES[0], sha256: 'abc' }] })).toBe(false);
		expect(isUsableRelease({ version: '0.5.0', files: [{ ...FILES[0], url: 'javascript:alert(1)' }] })).toBe(false);
		expect(isUsableRelease({ version: '0.5.0', files: [{ ...FILES[0], platform: 'beos' }] })).toBe(false);
	});
});

// The shape the release pipeline publishes today (0.5.0 on 2026-11-27): Windows
// and Linux builds, no macOS build.
const LIVE_LIKE = { schema: 1, version: '0.5.0', date: '2026-10-09', platforms: ['win', 'linux'], files: FILES.filter((f) => f.platform !== 'mac') };
const ALL = { schema: 1, version: '0.5.0', date: '2026-10-09', platforms: ['mac', 'win', 'linux'], files: FILES };

function feedResponse(body, { status = 200, type = 'application/json' } = {}) {
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
}

describe('readReleaseFeed', () => {
	it('returns a release that lists every platform', async () => {
		const fetchImpl = vi.fn(async () => feedResponse(ALL));
		const r = await readReleaseFeed(fetchImpl, '/releases/forge/release.json');
		expect(r.status).toBe('ok');
		expect(r.release.files).toHaveLength(6);
		expect(fetchImpl).toHaveBeenCalledWith('/releases/forge/release.json', expect.objectContaining({ cache: 'no-cache' }));
	});

	it('returns a release that is missing a platform', async () => {
		const r = await readReleaseFeed(async () => feedResponse(LIVE_LIKE));
		expect(r.status).toBe('ok');
		expect(new Set(r.release.files.map((f) => f.platform))).toEqual(new Set(['win', 'linux']));
	});

	it('reads a 404, an HTML fallback page or an unusable feed as "not released yet"', async () => {
		expect((await readReleaseFeed(async () => feedResponse('not found', { status: 404, type: 'text/plain' }))).status).toBe('unpublished');
		expect((await readReleaseFeed(async () => feedResponse('<!doctype html>', { type: 'text/html' }))).status).toBe('unpublished');
		expect((await readReleaseFeed(async () => feedResponse({ version: '0.5.0', files: [] }))).status).toBe('unpublished');
	});

	it('reports an unreachable source with a message the page can show', async () => {
		const offline = await readReleaseFeed(async () => {
			throw new TypeError('Failed to fetch');
		});
		expect(offline).toEqual({ status: 'error', message: expect.stringMatching(/could not reach three\.ws/i) });
		const down = await readReleaseFeed(async () => feedResponse('upstream', { status: 503, type: 'text/plain' }));
		expect(down.status).toBe('error');
		expect(down.message).toMatch(/503/);
		const garbled = await readReleaseFeed(async () => feedResponse('{"version":', { type: 'application/json' }));
		expect(garbled.status).toBe('error');
	});
});

describe('planDownloads', () => {
	it('offers each platform its own build when the release has all three', () => {
		for (const p of ['mac', 'win', 'linux']) {
			const plan = planDownloads(ALL, p);
			expect(plan.primary.platform).toBe(p);
			expect(plan.missingForVisitor).toBe(false);
		}
		expect(planDownloads(ALL, 'mac').note).toMatch(/Apple silicon/);
	});

	it('tells a Mac visitor there is no macOS build instead of claiming one', () => {
		const plan = planDownloads(LIVE_LIKE, 'mac');
		expect(plan.primary).toBeNull();
		expect(plan.missingForVisitor).toBe(true);
		expect(plan.available).toEqual(['win', 'linux']);
		expect(plan.note).toMatch(/no macOS build/i);
		expect(plan.note).not.toMatch(/Apple silicon Macs only/);
	});

	it('names only the platforms the release really has for a phone or tablet', () => {
		const plan = planDownloads(LIVE_LIKE, 'other');
		expect(plan.primary).toBeNull();
		expect(plan.missingForVisitor).toBe(false);
		expect(plan.note).toMatch(/Windows and Linux/);
		expect(plan.note).not.toMatch(/macOS/);
		expect(planDownloads(ALL, 'other').note).toMatch(/Windows, macOS and Linux/);
	});

	it('still offers Windows and Linux visitors their build when macOS is missing', () => {
		expect(planDownloads(LIVE_LIKE, 'win').primary.kind).toBe('nsis');
		expect(planDownloads(LIVE_LIKE, 'linux').primary.kind).toBe('appimage');
	});
});

describe('signingSummary', () => {
	it('says plainly whether the builds are code-signed', () => {
		expect(signingSummary(FILES).state).toBe('none');
		expect(signingSummary(FILES).text).toMatch(/not code-signed/i);
		expect(signingSummary(FILES.map((f) => ({ ...f, signed: true }))).state).toBe('all');
		const mixed = signingSummary(FILES.map((f) => ({ ...f, signed: f.platform === 'win' })));
		expect(mixed.state).toBe('mixed');
		expect(mixed.text).toMatch(/macOS and Linux/);
	});
});
