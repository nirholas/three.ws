import { describe, expect, it } from 'vitest';
import { detectPlatform, formatBytes, isUsableRelease, pickPrimary } from '../src/forge-desktop-release.js';

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
