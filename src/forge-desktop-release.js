// Pure helpers for the /forge-desktop download page: which OS the visitor is on,
// which file in release.json to offer them, and how to print a file size. Kept
// free of the DOM so tests/forge-desktop-release.test.js can exercise them.

export const PLATFORM_LABEL = { mac: 'macOS', win: 'Windows', linux: 'Linux' };

/**
 * The visitor's desktop platform, from User-Agent Client Hints when the browser
 * offers them and the user agent string otherwise. Phones and tablets are
 * 'other': Forge is a desktop app.
 * @param {{ userAgent?: string, platform?: string, userAgentData?: { platform?: string, mobile?: boolean } }} nav
 * @returns {'mac' | 'win' | 'linux' | 'other'}
 */
export function detectPlatform(nav) {
	const hints = nav.userAgentData;
	if (hints && typeof hints.platform === 'string' && hints.platform) {
		if (hints.mobile) return 'other';
		const p = hints.platform.toLowerCase();
		if (p === 'macos') return 'mac';
		if (p === 'windows') return 'win';
		if (p === 'linux') return 'linux';
		return 'other';
	}
	const ua = String(nav.userAgent || '');
	if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'other';
	if (/Windows NT/i.test(ua)) return 'win';
	// iPadOS reports a Mac user agent; a touch-capable "Mac" is an iPad.
	if (/Macintosh|Mac OS X/i.test(ua)) return Number(nav.maxTouchPoints) > 1 ? 'other' : 'mac';
	if (/CrOS/i.test(ua)) return 'other';
	if (/Linux|X11/i.test(ua)) return 'linux';
	return 'other';
}

/**
 * The file to put on the big download button: the platform's primary artifact
 * (dmg, setup.exe, AppImage), falling back to any file for that platform.
 * @param {Array<{ platform: string, primary?: boolean }>} files
 * @param {'mac' | 'win' | 'linux' | 'other'} platform
 */
export function pickPrimary(files, platform) {
	if (platform === 'other') return null;
	const mine = files.filter((f) => f.platform === platform);
	return mine.find((f) => f.primary) || mine[0] || null;
}

/** @param {number} bytes */
export function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) return '';
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 100 * 1024 ** 2 ? 1 : 0)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Accepts a parsed release.json only when every file the page renders has the
 * fields it renders, so a malformed feed reads as "not published" rather than
 * crashing the page halfway through the table.
 */
export function isUsableRelease(release) {
	if (!release || typeof release !== 'object' || typeof release.version !== 'string') return false;
	if (!Array.isArray(release.files) || release.files.length === 0) return false;
	return release.files.every(
		(f) =>
			f &&
			PLATFORM_LABEL[f.platform] &&
			typeof f.url === 'string' &&
			/^https:\/\//.test(f.url) &&
			typeof f.name === 'string' &&
			typeof f.label === 'string' &&
			typeof f.sha256 === 'string' &&
			/^[0-9a-f]{64}$/i.test(f.sha256),
	);
}
