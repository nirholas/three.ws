/**
 * Which Microsoft 365 host a three.ws tab runs in, and what that host can do.
 *
 * The same tab loads in Microsoft Teams, Outlook and the Microsoft 365 app
 * (manifest 1.13 or later runs one personal tab in all three), and in a plain
 * browser tab. TeamsJS reports the host in app.host.name; each capability has
 * its own isSupported(), and calling one the host lacks throws, so every
 * host-specific action is chosen here behind its isSupported() check.
 * https://learn.microsoft.com/en-us/microsoftteams/platform/m365-apps/extend-m365-teams-personal-tab
 *
 * TeamsJS is imported lazily and only when the page is framed: a visitor on
 * three.ws never downloads it, and outside a host app.initialize() never
 * resolves, so it is bounded by a timeout and falls back to "standalone".
 */

const INIT_TIMEOUT_MS = 6000;

let sdkPromise = null;
const loadSdk = () => (sdkPromise ??= import('@microsoft/teams-js'));

function withTimeout(promise, ms, label) {
	let timer;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
		}),
	]);
}

function isFramed() {
	try {
		return window.self !== window.top;
	} catch {
		return true;
	}
}

const HOST_LABELS = { teams: 'Microsoft Teams', outlook: 'Outlook', m365: 'the Microsoft 365 app', standalone: 'three.ws' };

/**
 * TeamsJS HostName to the host family the tab adapts to: 'teams', 'outlook',
 * 'm365' (the Microsoft 365 app, reported as Office) or 'standalone'.
 */
export function hostFamily(hostName) {
	const name = String(hostName || '').toLowerCase();
	if (name === 'teams' || name === 'teamsmodern') return 'teams';
	if (name === 'outlook' || name === 'outlookwin32') return 'outlook';
	if (name === 'office' || name === 'places') return 'm365';
	return 'standalone';
}

export function hostLabel(family) {
	return HOST_LABELS[family] || HOST_LABELS.standalone;
}

/** A TeamsJS theme ('default', 'dark', 'contrast') as the page's theme attributes. */
export function themeAttrs(theme) {
	if (theme === 'dark') return { theme: 'dark', contrast: false };
	if (theme === 'contrast') return { theme: 'dark', contrast: true };
	return { theme: 'light', contrast: false };
}

export function applyTheme(theme, root = document.documentElement) {
	const { theme: t, contrast } = themeAttrs(theme);
	root.setAttribute('data-theme', t);
	root.toggleAttribute('data-contrast', contrast);
}

function supported(capability) {
	try {
		return Boolean(capability?.isSupported?.());
	} catch {
		return false;
	}
}

/**
 * The share action this host supports for an agent link, or null:
 *   teams       sharing.shareWebContent (the Teams share dialog)
 *   outlook/m365 mail.composeMail (a new email with the link)
 *   standalone  the Web Share API, else copying the link
 * `nav` is the browser navigator (injected for tests).
 */
export function shareActionFor(host, nav = globalThis.navigator) {
	const sdk = host?.sdk;
	if (host?.family === 'teams' && supported(sdk?.sharing)) {
		return {
			kind: 'teams-share',
			label: 'Share in Teams',
			run: ({ url, title }) => sdk.sharing.shareWebContent({ content: [{ type: 'URL', url, message: title, preview: true }] }),
		};
	}
	if (host?.family !== 'standalone' && supported(sdk?.mail)) {
		return {
			kind: 'compose-mail',
			label: 'Email this agent',
			run: ({ url, title }) =>
				sdk.mail.composeMail({ type: sdk.mail.ComposeMailType.New, subject: title, message: `${title} on three.ws: ${url}` }),
		};
	}
	if (typeof nav?.share === 'function') {
		return { kind: 'web-share', label: 'Share', run: ({ url, title }) => nav.share({ title, url }) };
	}
	if (typeof nav?.clipboard?.writeText === 'function') {
		return { kind: 'copy-link', label: 'Copy link', run: ({ url }) => nav.clipboard.writeText(url) };
	}
	return null;
}

/**
 * Resolve the host. Always resolves:
 *   { family: 'standalone', reason } outside a Microsoft 365 host, otherwise
 *   { family, hostName, theme, sdk, context }.
 */
export async function detectHost() {
	if (!isFramed()) return { family: 'standalone', reason: 'not-framed' };
	let sdk;
	try {
		sdk = await loadSdk();
		await withTimeout(sdk.app.initialize(), INIT_TIMEOUT_MS, 'Microsoft 365 host initialize');
	} catch (err) {
		return { family: 'standalone', reason: 'no-host', error: err?.message || String(err) };
	}
	let context;
	try {
		context = await withTimeout(sdk.app.getContext(), INIT_TIMEOUT_MS, 'Microsoft 365 host context');
	} catch (err) {
		return { family: 'standalone', reason: 'no-context', error: err?.message || String(err) };
	}
	try {
		sdk.app.notifySuccess();
	} catch {
		// Hosts that load the tab without the success handshake need nothing more.
	}
	const hostName = context.app?.host?.name || '';
	const family = hostFamily(hostName);
	return { family: family === 'standalone' ? 'm365' : family, hostName, theme: context.app?.theme || 'default', sdk, context };
}

/** Follow the host theme as the user changes it. */
export function onHostThemeChange(host, handler) {
	if (!host?.sdk) return;
	try {
		host.sdk.app.registerOnThemeChangeHandler(handler);
	} catch {
		// Hosts without theme events keep the theme passed at load.
	}
}
