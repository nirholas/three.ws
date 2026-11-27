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

const PLATFORM_ORDER = ['win', 'mac', 'linux'];

/** "Windows", "Windows and Linux", "Windows, macOS and Linux". */
function listLabels(platforms) {
	const labels = platforms.map((p) => PLATFORM_LABEL[p]);
	if (labels.length <= 1) return labels.join('');
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Fetch and classify release.json. Never throws.
 *  - { status: 'ok', release }   a usable release
 *  - { status: 'unpublished' }   no release yet: a 404, the SPA's HTML fallback,
 *                                or a feed with nothing the page can render
 *  - { status: 'error', message } the source could not be read; message is
 *                                written for the visitor
 */
export async function readReleaseFeed(fetchImpl = globalThis.fetch, url = '/releases/forge/release.json') {
	let res;
	try {
		res = await fetchImpl(url, { headers: { accept: 'application/json' }, cache: 'no-cache' });
	} catch {
		return { status: 'error', message: 'Could not reach three.ws. Check your connection and try again.' };
	}
	if (res.status === 404) return { status: 'unpublished' };
	if (!res.ok) {
		return { status: 'error', message: `The release feed answered ${res.status}. Try again in a minute.` };
	}
	const type = res.headers.get('content-type') || '';
	if (!/json/i.test(type)) return { status: 'unpublished' };
	let release;
	try {
		release = await res.json();
	} catch {
		return { status: 'error', message: 'The release feed could not be read. Try again in a minute.' };
	}
	return isUsableRelease(release) ? { status: 'ok', release } : { status: 'unpublished' };
}

/**
 * What the download hero offers this visitor.
 *  primary            the file for the big button, or null
 *  missingForVisitor  true when the visitor's desktop OS has no build in this release
 *  available          platforms with at least one file, in a stable order
 *  note               one honest sentence under the button
 */
export function planDownloads(release, platform) {
	const files = Array.isArray(release?.files) ? release.files : [];
	const available = PLATFORM_ORDER.filter((p) => files.some((f) => f.platform === p));
	const primary = pickPrimary(files, platform);
	const desktop = platform === 'mac' || platform === 'win' || platform === 'linux';
	const missingForVisitor = desktop && !primary;
	const others = listLabels(available);
	let note;
	if (primary && platform === 'mac') {
		note = 'For Apple silicon Macs (M1 or later).';
	} else if (primary) {
		note = available.length > 1 ? `Also available for ${listLabels(available.filter((p) => p !== platform))}.` : '';
	} else if (missingForVisitor) {
		note = `There is no ${PLATFORM_LABEL[platform]} build in this release yet. Builds are available for ${others}, or you can run Forge from source.`;
	} else {
		note = `Forge is a desktop app. Builds are available for ${others} computers.`;
	}
	return { primary, missingForVisitor, available, note };
}

/**
 * One line on code signing across the release, so the page never implies a
 * signature the files do not carry.
 */
export function signingSummary(files) {
	const list = Array.isArray(files) ? files : [];
	const platforms = PLATFORM_ORDER.filter((p) => list.some((f) => f.platform === p));
	const unsigned = platforms.filter((p) => list.some((f) => f.platform === p && !f.signed));
	if (unsigned.length === 0) {
		return { state: 'all', text: 'Every build in this release is code-signed.' };
	}
	if (unsigned.length === platforms.length) {
		return {
			state: 'none',
			text: 'These builds are not code-signed yet, so your system will warn you the first time you open one. Check the SHA-256 below before you run it.',
		};
	}
	return {
		state: 'mixed',
		text: `The ${listLabels(unsigned)} builds are not code-signed yet, so your system will warn you the first time you open one. Check the SHA-256 below before you run it.`,
	};
}
