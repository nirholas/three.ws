/**
 * The Microsoft Teams side of the review stage: detect whether the page runs
 * inside a Teams meeting, read who the user is, and drive the meeting APIs
 * (share to stage, the configurable tab's save handler).
 *
 * The Teams JS SDK is imported lazily and only when the page is framed, so a
 * visitor opening /microsoft/teams-stage in a normal browser tab never
 * downloads it. Outside a host, app.initialize() never resolves, so every call
 * is bounded by a timeout and resolves to a plain "not in Teams" answer.
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

/**
 * Resolve the host the page runs in.
 * Returns { inTeams: false } outside Teams, otherwise
 * { inTeams: true, sdk, frameContext, meetingId, user: { id, name }, theme }.
 */
export async function detectTeams() {
	if (!isFramed()) return { inTeams: false, reason: 'not-framed' };
	let sdk;
	try {
		sdk = await loadSdk();
		await withTimeout(sdk.app.initialize(), INIT_TIMEOUT_MS, 'Teams initialize');
	} catch (err) {
		return { inTeams: false, reason: 'no-host', error: err?.message || String(err) };
	}
	let context;
	try {
		context = await withTimeout(sdk.app.getContext(), INIT_TIMEOUT_MS, 'Teams context');
	} catch (err) {
		return { inTeams: false, reason: 'no-context', error: err?.message || String(err) };
	}
	try {
		sdk.app.notifySuccess();
	} catch {
		// Older hosts load the tab without the success handshake; nothing to do.
	}
	const u = context.user || {};
	return {
		inTeams: true,
		sdk,
		frameContext: context.page?.frameContext || 'content',
		meetingId: context.meeting?.id || null,
		hostName: context.app?.host?.name || 'Teams',
		theme: context.app?.theme || 'default',
		user: { id: u.id || u.aadObjectId || null, name: u.displayName || u.userPrincipalName || '' },
		context,
	};
}

/** Follow the Teams theme as it changes during a meeting. */
export function onThemeChange(host, handler) {
	if (!host?.inTeams) return;
	try {
		host.sdk.app.registerOnThemeChangeHandler(handler);
	} catch {
		// Hosts without theme events keep the theme passed at load.
	}
}

/** The Live Share host for a Teams meeting. */
export function createLiveShareHost(host) {
	return host.sdk.LiveShareHost.create();
}

function callbackApi(fn, ...args) {
	return new Promise((resolve, reject) => {
		try {
			fn((err, result) => (err ? reject(Object.assign(new Error(err.message || `Teams error ${err.errorCode}`), { code: err.errorCode })) : resolve(result)), ...args);
		} catch (err) {
			reject(err);
		}
	});
}

/** Whether this user may share to the meeting stage, and whether the app already is on it. */
export async function stageSharing(host) {
	const { meeting } = host.sdk;
	const [caps, state] = await Promise.all([
		callbackApi(meeting.getAppContentStageSharingCapabilities).catch(() => null),
		callbackApi(meeting.getAppContentStageSharingState).catch(() => null),
	]);
	return { canShare: caps?.doesAppHaveSharePermission === true, isSharing: state?.isAppSharing === true };
}

/** Put the stage page on the meeting stage for everyone. */
export function shareToStage(host, url) {
	return callbackApi(host.sdk.meeting.shareAppContentToStage, url);
}

/**
 * The configurable tab's settings page: the tab needs no choices, so it
 * declares itself valid and saves the stage URL as the content page. Teams
 * shows that page in the meeting side panel and on the stage.
 */
export function registerTabConfig(host, { contentUrl, websiteUrl }) {
	const { pages } = host.sdk;
	pages.config.registerOnSaveHandler((saveEvent) => {
		pages.config
			.setConfig({ entityId: 'threews-stage', suggestedDisplayName: 'three.ws Review', contentUrl, websiteUrl })
			.then(() => saveEvent.notifySuccess(), (err) => saveEvent.notifyFailure(err?.message || 'Could not save the tab'));
	});
	pages.config.setValidityState(true);
}
