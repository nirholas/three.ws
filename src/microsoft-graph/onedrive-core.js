// OneDrive and SharePoint plumbing that has no browser or MSAL dependency, so
// it can be unit tested in Node (tests/onedrive-core.test.js):
//
//   • the File Picker v8 configuration and its postMessage command protocol
//     (https://learn.microsoft.com/onedrive/developer/controls/file-pickers/)
//   • picked-item download through Microsoft Graph
//   • uploads: a single PUT up to 4 MB, an upload session with 320 KiB-aligned
//     chunks above that, resumed from `nextExpectedRanges`
//   • Retry-After handling and the mapping from Graph and MSAL failures to a
//     message a person can act on
//
// The browser layer (src/microsoft-graph/onedrive-client.js) supplies fetch,
// tokens and the message port.

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
/** Personal Microsoft accounts all live in this one Entra tenant. */
export const MSA_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';
export const CONSUMER_PICKER_BASE = 'https://onedrive.live.com/picker';

/** Graph delegated scope for reading picked photos and saving exports. */
export const GRAPH_SCOPES = ['Files.ReadWrite'];
/** Token scope the consumer picker page itself asks for (granted by Files.ReadWrite consent). */
export const CONSUMER_PICKER_SCOPES = ['OneDrive.ReadWrite'];

/** Graph allows a single-request PUT up to 4 MB; larger files need an upload session. */
export const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
/** Upload-session chunks must be multiples of 320 KiB. */
export const CHUNK_UNIT = 320 * 1024;
/** 10 MiB: inside Microsoft's recommended 5-10 MiB band, and aligned to CHUNK_UNIT. */
export const DEFAULT_CHUNK_SIZE = 32 * CHUNK_UNIT;
/** Largest picked photo we download; Forge's photo prep shrinks big originals below its 8 MB cap. */
export const MAX_PICK_BYTES = 40 * 1024 * 1024;
export const PICK_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const PICK_IMAGE_FILTERS = ['.png', '.jpg', '.jpeg', '.webp'];

const MAX_RETRIES = 4;
const MAX_RETRY_WAIT_MS = 60_000;

export class OneDriveError extends Error {
	/**
	 * @param {string} code machine-readable reason (see oneDriveErrorMessage)
	 * @param {string} message text written for the person using the page
	 * @param {{ status?: number, retryable?: boolean, cause?: unknown }} [extra]
	 */
	constructor(code, message, { status = 0, retryable = false, cause } = {}) {
		super(message);
		this.name = 'OneDriveError';
		this.code = code;
		this.status = status;
		this.retryable = retryable;
		if (cause !== undefined) this.cause = cause;
	}
}

// ---- accounts and picker configuration --------------------------------------

/** True for a personal Microsoft account (outlook.com, hotmail, live). */
export function isConsumerAccount(account) {
	if (!account) return false;
	const tid = account.tenantId || account.idTokenClaims?.tid || '';
	return String(tid).toLowerCase() === MSA_TENANT_ID;
}

/**
 * The picker host for a work or school account: the origin of the user's
 * OneDrive web URL (https://contoso-my.sharepoint.com/personal/... gives
 * https://contoso-my.sharepoint.com), the form Microsoft's docs use.
 */
export function businessPickerBase(driveWebUrl) {
	let url;
	try {
		url = new URL(driveWebUrl);
	} catch {
		throw new OneDriveError('no_drive', 'Your Microsoft 365 account has no OneDrive yet. Open OneDrive once in a browser, then try again.');
	}
	if (url.protocol !== 'https:' || !/\.sharepoint\.(com|us|de|cn)$|\.sharepoint-mil\.us$|\.dps\.mil$/i.test(url.hostname)) {
		throw new OneDriveError('no_drive', 'Your account does not have a SharePoint-hosted OneDrive this picker can open.');
	}
	return url.origin;
}

/** MSAL scopes for a picker `authenticate` command. */
export function pickerTokenScopes(command, { consumer }) {
	if (consumer) return CONSUMER_PICKER_SCOPES;
	const type = String(command?.type || '').toLowerCase();
	if (type === 'graph') return ['https://graph.microsoft.com/.default'];
	let origin;
	try {
		origin = new URL(command?.resource).origin;
	} catch {
		throw new OneDriveError('bad_resource', 'The picker asked for access to an unknown location.');
	}
	return [`${origin}/.default`];
}

/**
 * File Picker v8 options.
 * @param {{ channelId: string, origin: string, mode: 'files'|'folders', consumer: boolean, maximumCount?: number, theme?: 'default'|'dark' }} o
 */
export function buildPickerOptions({ channelId, origin, mode, consumer, maximumCount = 1, theme = 'default' }) {
	const folders = mode === 'folders';
	const multiple = !folders && maximumCount > 1;
	const options = {
		sdk: '8.0',
		entry: { oneDrive: consumer ? {} : { files: {} } },
		// Present (even empty) so the picker asks us for tokens and returns item details.
		authentication: {},
		messaging: { origin, channelId },
		typesAndSources: {
			mode: folders ? 'folders' : 'files',
			pivots: consumer
				? { oneDrive: true, recent: true, shared: true }
				: { oneDrive: true, recent: true, shared: true, sharedLibraries: true, myOrganization: true, site: true },
		},
		selection: multiple ? { mode: 'multiple', maximumCount } : { mode: 'single' },
		commands: {
			pick: { label: folders ? 'Save here' : multiple ? 'Add photos' : 'Add photo' },
			close: { label: 'Cancel' },
			browseThisDevice: { enabled: false },
		},
		accessibility: { enableFocusTrap: true, trapFocusOnLoad: true, showFocusOnLoad: true },
		theme,
		title: folders ? 'Choose a folder for your model' : 'Choose photos of one object',
	};
	if (!folders) options.typesAndSources.filters = PICK_IMAGE_FILTERS;
	if (folders) options.typesAndSources.access = { mode: 'read-write' };
	return options;
}

/** The URL the picker form is POSTed to. */
export function pickerActionUrl(baseUrl, options, locale = 'en-us') {
	const qs = new URLSearchParams({ filePicker: JSON.stringify(options), locale });
	return `${baseUrl.replace(/\/+$/, '')}/_layouts/15/FilePicker.aspx?${qs}`;
}

// ---- picker message protocol -------------------------------------------------

/**
 * True when a window message is the picker's `initialize` for our channel.
 * `expectedSource` is the picker's window; a message from any other window
 * (another tab, an injected frame) is ignored.
 */
export function isPickerInitialize(event, { channelId, expectedSource }) {
	return Boolean(
		event &&
			event.source === expectedSource &&
			event.data &&
			event.data.type === 'initialize' &&
			event.data.channelId === channelId &&
			event.ports &&
			event.ports[0],
	);
}

/**
 * Handles the messages that arrive on the picker's MessagePort. Every command
 * is acknowledged, then answered with a result, as the protocol requires.
 *
 * @param {{
 *   post: (msg: object) => void,
 *   getToken: (command: object) => Promise<string>,
 *   onPick: (items: object[]) => Promise<void> | void,
 *   onClose: () => void,
 *   onReady?: () => void,
 * }} handlers
 */
export function createPickerChannel({ post, getToken, onPick, onClose, onReady = () => {} }) {
	const result = (id, data) => post({ type: 'result', id, data });
	const error = (id, code, message) => result(id, { result: 'error', error: { code, message } });

	return async function handle(payload) {
		if (!payload || typeof payload !== 'object') return;
		if (payload.type === 'notification') {
			if (payload.data?.notification === 'page-loaded') onReady();
			return;
		}
		if (payload.type !== 'command') return;
		const id = payload.id;
		post({ type: 'acknowledge', id });
		const command = payload.data || {};
		switch (command.command) {
			case 'authenticate': {
				try {
					const token = await getToken(command);
					if (!token) throw new Error('Unable to obtain a token.');
					result(id, { result: 'token', token });
				} catch (err) {
					error(id, 'unableToObtainToken', err?.message || 'Unable to obtain a token.');
				}
				return;
			}
			case 'pick': {
				try {
					await onPick(Array.isArray(command.items) ? command.items : []);
					result(id, { result: 'success' });
				} catch (err) {
					error(id, 'unusableItem', err?.message || 'That item cannot be used.');
				}
				return;
			}
			case 'close':
				result(id, { result: 'success' });
				onClose();
				return;
			default:
				error(id, 'unsupportedCommand', String(command.command || 'unknown'));
		}
	};
}

/** Graph address of a picked item. Throws when the picker omitted the guaranteed fields. */
export function pickedItemRef(item) {
	const id = item?.id;
	const driveId = item?.parentReference?.driveId;
	if (!id || !driveId) throw new OneDriveError('bad_item', 'The picker returned an item three.ws could not open. Pick it again.');
	return { id, driveId };
}

// ---- names -------------------------------------------------------------------

/** A filename OneDrive and SharePoint both accept. */
export function safeDriveFileName(name, fallback = 'three-ws-model') {
	let out = String(name || '')
		.normalize('NFKC')
		.replace(/[\u0000-\u001f"*:<>?/\\|#%]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[.\s~]+|[.\s]+$/g, '');
	if (!out) out = fallback;
	if (out.length > 120) out = out.slice(0, 120).trim();
	return out;
}

// ---- retry and errors --------------------------------------------------------

/** Milliseconds to wait from a Retry-After header (delta seconds or HTTP date). */
export function retryAfterMs(header, now = Date.now(), fallbackMs = 2000) {
	if (header == null || header === '') return fallbackMs;
	const s = String(header).trim();
	if (/^\d+(\.\d+)?$/.test(s)) return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, Math.round(Number(s) * 1000)));
	const at = Date.parse(s);
	if (Number.isFinite(at)) return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, at - now));
	return fallbackMs;
}

function backoffMs(attempt) {
	return Math.min(MAX_RETRY_WAIT_MS, 1000 * 2 ** attempt);
}

/** A OneDriveError for a failed Graph response. */
export function graphResponseError(status, body = {}) {
	const err = body?.error || {};
	const code = String(err.code || '');
	const inner = String(err.innerError?.code || err.innererror?.code || '');
	const has = (c) => code === c || inner === c;
	if (status === 507 || has('quotaLimitReached') || has('insufficientStorage'))
		return new OneDriveError('quota_full', 'That OneDrive or library is full. Free up space or pick another folder, then try again.', { status });
	if (status === 401)
		return new OneDriveError('token_expired', 'Your Microsoft sign-in expired. Sign in again to continue.', { status });
	if (status === 403 || has('accessDenied'))
		return new OneDriveError('access_denied', 'You do not have permission to use that location. Pick a folder you can edit.', { status });
	if (status === 404 || has('itemNotFound'))
		return new OneDriveError('not_found', 'That file or folder is no longer in OneDrive. Pick it again.', { status });
	if (status === 409 || has('nameAlreadyExists'))
		return new OneDriveError('conflict', 'A file with that name is in the way. Try again.', { status });
	if (status === 413)
		return new OneDriveError('too_large', 'That file is larger than OneDrive accepts here.', { status });
	if (status === 423 || has('resourceLocked'))
		return new OneDriveError('locked', 'That file is open or checked out somewhere else. Close it and try again.', { status });
	if (status === 429 || status === 503 || has('activityLimitReached'))
		return new OneDriveError('throttled', 'Microsoft is limiting requests right now. Wait a minute and try again.', { status, retryable: true });
	if (status >= 500)
		return new OneDriveError('server', 'OneDrive had a problem on its side. Try again in a minute.', { status, retryable: true });
	return new OneDriveError('graph_error', err.message ? `OneDrive refused the request: ${err.message}` : `OneDrive refused the request (${status}).`, { status });
}

/**
 * Turn an MSAL error into a OneDriveError. Cancel stays distinguishable
 * (code "cancelled") so the UI can close quietly instead of showing an error.
 */
export function msalError(err) {
	if (err instanceof OneDriveError) return err;
	const code = String(err?.errorCode || err?.code || '').toLowerCase();
	const text = `${err?.errorMessage || ''} ${err?.message || ''} ${err?.subError || ''}`;
	if (code === 'user_cancelled' || code === 'user_canceled')
		return new OneDriveError('cancelled', 'Sign-in was cancelled.', { cause: err });
	if (/AADSTS65004|consent_declined/i.test(text) || (code === 'access_denied' && /declin|consent/i.test(text)))
		return new OneDriveError('consent_declined', 'three.ws needs permission to your OneDrive files for this. Choose Accept on the Microsoft screen, or add the photo from your device instead.', { cause: err });
	if (/AADSTS90094|AADSTS90008|AADSTS65001|admin.?consent|need_admin_approval/i.test(text))
		return new OneDriveError('admin_required', 'Your organization requires an IT admin to approve three.ws for OneDrive. Ask your admin to grant consent (three.ws/docs/onedrive), or add the photo from your device.', { cause: err });
	if (code === 'popup_window_error' || code === 'empty_window_error' || /popup.*block/i.test(text))
		return new OneDriveError('popup_blocked', 'Your browser blocked the Microsoft sign-in window. Allow pop-ups for three.ws, then select Continue.', { cause: err, retryable: true });
	if (code === 'interaction_in_progress')
		return new OneDriveError('busy', 'A Microsoft sign-in window is already open. Finish or close it, then try again.', { cause: err });
	if (code === 'no_network_connectivity' || code === 'network_error' || /network/i.test(code))
		return new OneDriveError('offline', 'Could not reach Microsoft. Check your connection and try again.', { cause: err, retryable: true });
	if (code === 'redirect_uri_mismatch' || /AADSTS50011/i.test(text))
		return new OneDriveError('not_configured', 'OneDrive sign-in is not set up correctly on this site yet. Add the photo from your device for now.', { cause: err });
	if (code === 'monitor_window_timeout' || code === 'timed_out')
		return new OneDriveError('timeout', 'The Microsoft sign-in window did not finish. Try again.', { cause: err, retryable: true });
	return new OneDriveError('auth_failed', `Microsoft sign-in failed${err?.errorCode ? ` (${err.errorCode})` : ''}. Try again.`, { cause: err });
}

/** True when an MSAL silent failure means a person has to see a Microsoft screen. */
export function needsInteraction(err) {
	if (!err) return false;
	if (err.name === 'InteractionRequiredAuthError') return true;
	const code = String(err.errorCode || '').toLowerCase();
	return ['interaction_required', 'consent_required', 'login_required', 'no_tokens_found', 'no_account_error', 'token_refresh_required', 'refresh_token_expired', 'bad_token', 'native_account_unavailable'].includes(code);
}

/**
 * fetch against Graph with the token attached, honoring Retry-After on 429
 * and 503 and retrying 5xx with backoff. `getToken(forceRefresh)` is called
 * again once on a 401, which covers a token that expired mid-flow.
 */
export async function graphRequest(url, { fetch, getToken, method = 'GET', headers = {}, body, sleep = defaultSleep, signal } = {}) {
	let token = await getToken(false);
	let refreshed = false;
	for (let attempt = 0; ; attempt++) {
		let res;
		try {
			res = await fetch(url, { method, headers: { ...headers, authorization: `Bearer ${token}` }, body, signal });
		} catch (err) {
			if (signal?.aborted) throw new OneDriveError('cancelled', 'Cancelled.', { cause: err });
			throw offlineError(err);
		}
		if (res.ok) return res;
		if (res.status === 401 && !refreshed) {
			refreshed = true;
			token = await getToken(true);
			continue;
		}
		const retryable = res.status === 429 || res.status === 503 || res.status >= 500;
		if (retryable && attempt < MAX_RETRIES) {
			const wait = res.status === 429 || res.status === 503 ? retryAfterMs(res.headers?.get?.('retry-after'), Date.now(), backoffMs(attempt)) : backoffMs(attempt);
			await sleep(wait, signal);
			continue;
		}
		throw graphResponseError(res.status, await res.json().catch(() => ({})));
	}
}

function offlineError(cause) {
	const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
	return new OneDriveError(
		'offline',
		offline ? 'You are offline. Reconnect to the internet and try again.' : 'Could not reach OneDrive. Check your connection and try again.',
		{ retryable: true, cause },
	);
}

function defaultSleep(ms, signal) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener?.(
			'abort',
			() => {
				clearTimeout(t);
				reject(new OneDriveError('cancelled', 'Cancelled.'));
			},
			{ once: true },
		);
	});
}

// ---- download a picked photo -------------------------------------------------

/**
 * Download a picked photo as a File, validated against the Forge image types.
 * Uses the item's pre-authenticated download URL (CORS-enabled) rather than
 * /content, whose redirect drops the Authorization header cross-origin.
 */
export async function downloadPickedImage(item, { fetch, getToken, sleep, signal }) {
	const { id, driveId } = pickedItemRef(item);
	const metaUrl = `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(id)}?$select=id,name,size,file,@microsoft.graph.downloadUrl`;
	const meta = await (await graphRequest(metaUrl, { fetch, getToken, sleep, signal })).json();
	const name = meta.name || item.name || 'photo';
	const type = normalizeImageType(meta.file?.mimeType, name);
	if (!type) throw new OneDriveError('bad_type', `${name} is not a PNG, JPG or WebP photo.`);
	if (Number(meta.size) > MAX_PICK_BYTES) throw new OneDriveError('too_large', `${name} is over 40 MB. Pick a smaller photo.`);
	const href = meta['@microsoft.graph.downloadUrl'];
	if (!href) throw new OneDriveError('no_download', `OneDrive would not hand over ${name}. Check you can open it, then try again.`);
	let res;
	try {
		res = await fetch(href, { signal });
	} catch (err) {
		if (signal?.aborted) throw new OneDriveError('cancelled', 'Cancelled.', { cause: err });
		throw offlineError(err);
	}
	if (!res.ok) throw graphResponseError(res.status, await res.json().catch(() => ({})));
	const blob = await res.blob();
	return new File([blob], name, { type });
}

/** One of PICK_IMAGE_TYPES, from the Graph mime type or the extension, else null. */
export function normalizeImageType(mimeType, name = '') {
	const m = String(mimeType || '').toLowerCase();
	if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg';
	if (PICK_IMAGE_TYPES.includes(m)) return m;
	const ext = String(name).toLowerCase().split('.').pop();
	if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
	if (ext === 'png') return 'image/png';
	if (ext === 'webp') return 'image/webp';
	return null;
}

// ---- upload ------------------------------------------------------------------

/**
 * Byte ranges for an upload session. Every chunk but the last is a multiple
 * of 320 KiB, as Graph requires.
 * @returns {{ start: number, end: number }[]} inclusive ranges
 */
export function planChunks(size, chunkSize = DEFAULT_CHUNK_SIZE, from = 0) {
	if (!Number.isFinite(size) || size <= 0) return [];
	const step = Math.max(CHUNK_UNIT, Math.floor(chunkSize / CHUNK_UNIT) * CHUNK_UNIT);
	const out = [];
	for (let start = Math.max(0, from); start < size; start += step) out.push({ start, end: Math.min(start + step, size) - 1 });
	return out;
}

/** The first missing byte from an upload session's `nextExpectedRanges` ("12345-" or "0-99"). */
export function nextExpectedStart(ranges) {
	const first = Array.isArray(ranges) ? ranges[0] : null;
	const m = /^(\d+)-/.exec(String(first || ''));
	return m ? Number(m[1]) : null;
}

/** Content-Range header value for an inclusive range. */
export function contentRange(start, end, size) {
	return `bytes ${start}-${end}/${size}`;
}

/**
 * Upload a Blob into a drive folder. Returns the created driveItem.
 * @param {{
 *   fetch: typeof fetch, getToken: (force: boolean) => Promise<string>,
 *   driveId: string, folderId: string, name: string, blob: Blob,
 *   onProgress?: (fraction: number) => void, chunkSize?: number,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, signal?: AbortSignal,
 * }} o
 */
export async function uploadToFolder({ fetch, getToken, driveId, folderId, name, blob, onProgress = () => {}, chunkSize = DEFAULT_CHUNK_SIZE, sleep = defaultSleep, signal }) {
	const fileName = safeDriveFileName(name);
	const base = `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:`;
	onProgress(0);
	if (blob.size <= SIMPLE_UPLOAD_MAX) {
		const res = await graphRequest(`${base}/content?@microsoft.graph.conflictBehavior=rename`, {
			fetch,
			getToken,
			method: 'PUT',
			headers: { 'content-type': blob.type || 'application/octet-stream' },
			body: blob,
			sleep,
			signal,
		});
		onProgress(1);
		return res.json();
	}

	const session = await (
		await graphRequest(`${base}/createUploadSession`, {
			fetch,
			getToken,
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name: fileName } }),
			sleep,
			signal,
		})
	).json();
	const uploadUrl = session.uploadUrl;
	if (!uploadUrl) throw new OneDriveError('graph_error', 'OneDrive did not open an upload session. Try again.');

	try {
		return await sendChunks({ fetch, uploadUrl, blob, chunkSize, onProgress, sleep, signal });
	} catch (err) {
		// Leave nothing half-written behind: an abandoned session holds the
		// partial bytes until it expires.
		fetch(uploadUrl, { method: 'DELETE' }).catch(() => {});
		throw err;
	}
}

async function sendChunks({ fetch, uploadUrl, blob, chunkSize, onProgress, sleep, signal }) {
	const size = blob.size;
	const step = planChunks(size, chunkSize)[0].end + 1;
	let start = 0;
	let failures = 0;
	while (start < size) {
		const end = Math.min(start + step, size) - 1;
		let res;
		try {
			// No Authorization header: the upload URL is pre-authenticated, and
			// Graph rejects a bearer token here.
			res = await fetch(uploadUrl, {
				method: 'PUT',
				headers: { 'content-range': contentRange(start, end, size) },
				body: blob.slice(start, end + 1),
				signal,
			});
		} catch (err) {
			if (signal?.aborted) throw new OneDriveError('cancelled', 'Cancelled.', { cause: err });
			if (++failures > MAX_RETRIES) throw offlineError(err);
			await sleep(backoffMs(failures), signal);
			start = (await resumePoint(fetch, uploadUrl, signal)) ?? start;
			continue;
		}
		if (res.status === 200 || res.status === 201) {
			onProgress(1);
			return res.json();
		}
		if (res.status === 202) {
			failures = 0;
			const body = await res.json().catch(() => ({}));
			start = nextExpectedStart(body.nextExpectedRanges) ?? end + 1;
			onProgress(start / size);
			continue;
		}
		if (res.status === 404) throw new OneDriveError('session_expired', 'The OneDrive upload timed out. Save again.', { status: 404 });
		const retryable = res.status === 416 || res.status === 429 || res.status === 503 || res.status >= 500;
		if (retryable && ++failures <= MAX_RETRIES) {
			const wait = res.status === 429 || res.status === 503 ? retryAfterMs(res.headers?.get?.('retry-after'), Date.now(), backoffMs(failures)) : backoffMs(failures);
			await sleep(wait, signal);
			start = (await resumePoint(fetch, uploadUrl, signal)) ?? start;
			continue;
		}
		throw graphResponseError(res.status, await res.json().catch(() => ({})));
	}
	throw new OneDriveError('graph_error', 'OneDrive did not confirm the upload. Save again.');
}

/** Ask the session which bytes it still needs; null when it cannot say. */
async function resumePoint(fetch, uploadUrl, signal) {
	try {
		const res = await fetch(uploadUrl, { signal });
		if (!res.ok) return null;
		return nextExpectedStart((await res.json()).nextExpectedRanges);
	} catch {
		return null;
	}
}
