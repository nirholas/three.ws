// Browser side of the OneDrive and SharePoint integration: MSAL sign-in on the
// multitenant three.ws Entra app, the tokens Graph and the File Picker need,
// and hosting File Picker v8 inside an iframe the caller owns.
//
// Loaded lazily (dynamic import) the first time someone uses a OneDrive
// action, so MSAL never ships in the initial Forge bundle. The protocol and
// upload logic live in ./onedrive-core.js, which is unit tested.
//
// Scopes are requested only here, on a click, never at three.ws sign-in:
//   Graph Files.ReadWrite  read the picked photo, write the saved model
//   OneDrive.ReadWrite     the consumer picker page (granted by the above)
//   <sharepoint>/.default  the work picker page (SharePoint MyFiles.Write,
//                          AllSites.Read on the app registration)

import { BrowserAuthError, PublicClientApplication } from '@azure/msal-browser';

import {
	AUTHORITY,
	CONSUMER_PICKER_BASE,
	GRAPH_BASE,
	GRAPH_SCOPES,
	OneDriveError,
	buildPickerOptions,
	businessPickerBase,
	createPickerChannel,
	graphRequest,
	isConsumerAccount,
	isPickerInitialize,
	msalError,
	needsInteraction,
	pickerActionUrl,
	pickerTokenScopes,
	REDIRECT_PATH,
	watchPopupClosed,
} from './onedrive-core.js';

/**
 * How long the sign-in popup may stay open. MSAL's default is 60 s, which cuts
 * off a person still typing a password or approving MFA; closing the window is
 * noticed separately (CancellablePopupApplication below).
 */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

/**
 * MSAL's PublicClientApplication with a sign-in popup that can be cancelled by
 * closing it. waitForPopupResponse is MSAL's hook for subclasses; ours races
 * the redirect bridge against watchPopupClosed and answers a close with MSAL's
 * own user_cancelled error, which MSAL turns into a clean interaction end.
 */
class CancellablePopupApplication extends PublicClientApplication {
	async waitForPopupResponse(request, popupWindow, popupWindowParent) {
		const watch = watchPopupClosed(popupWindow);
		try {
			return await Promise.race([
				super.waitForPopupResponse(request, popupWindow, popupWindowParent),
				watch.promise.then(() => {
					throw new BrowserAuthError('user_cancelled', 'The Microsoft sign-in window was closed.');
				}),
			]);
		} finally {
			watch.stop();
		}
	}
}

/**
 * MSAL settings for the OneDrive session. Tokens live in sessionStorage: scoped
 * to the three.ws origin and to this tab, gone when the tab closes, and never
 * written to localStorage or a cookie that outlives the session.
 * tests/onedrive-token-storage.test.js runs real MSAL with this config.
 */
export function msalConfig(clientId, origin) {
	return {
		auth: { clientId, authority: AUTHORITY, redirectUri: `${origin}${REDIRECT_PATH}` },
		cache: { cacheLocation: 'sessionStorage' },
		system: { popupBridgeTimeout: SIGN_IN_TIMEOUT_MS },
	};
}

/** How long the picker page may take to say hello before we call it broken. */
const PICKER_INIT_TIMEOUT_MS = 45_000;

/**
 * One signed-in Microsoft account and the tokens it can mint.
 *
 * `askToContinue(message)` is the UI's way to get a fresh click before an
 * interactive MSAL popup: browsers block popups opened without one, so a
 * silent-token failure mid-flow shows a Continue button and waits on it.
 */
export function createOneDriveSession({ clientId, askToContinue }) {
	if (!clientId) throw new OneDriveError('not_configured', 'OneDrive is not set up on this site.');
	const pca = new CancellablePopupApplication(msalConfig(clientId, location.origin));
	let ready = null;
	let pickerBase = null;
	const init = () => (ready ||= pca.initialize());

	const account = () => pca.getActiveAccount() || pca.getAllAccounts()[0] || null;

	async function interactive(scopes) {
		try {
			const r = await pca.acquireTokenPopup({ scopes, account: account() || undefined });
			if (r.account) pca.setActiveAccount(r.account);
			return r.accessToken;
		} catch (err) {
			throw msalError(err);
		}
	}

	/** A token for `scopes`, silent first, then a popup behind a Continue click. */
	async function token(scopes, { force = false, reason } = {}) {
		await init();
		const acct = account();
		if (acct) {
			try {
				const r = await pca.acquireTokenSilent({ scopes, account: acct, forceRefresh: force });
				return r.accessToken;
			} catch (err) {
				if (!needsInteraction(err)) throw msalError(err);
			}
		}
		await askToContinue(reason || 'Microsoft needs you to confirm access to your files.');
		return interactive(scopes);
	}

	return {
		/** Load MSAL's cache ahead of a click, so the click can open the popup straight away. */
		warm: () => init(),
		/**
		 * Make sure someone is signed in. Call straight from a click handler:
		 * the sign-in popup needs that click's user activation.
		 */
		async signIn({ switchAccount = false } = {}) {
			await init();
			if (!switchAccount && account()) return account();
			try {
				const r = await pca.loginPopup({ scopes: GRAPH_SCOPES, prompt: 'select_account' });
				pca.setActiveAccount(r.account);
				pickerBase = null;
				return r.account;
			} catch (err) {
				throw msalError(err);
			}
		},
		get account() {
			return account();
		},
		get consumer() {
			return isConsumerAccount(account());
		},
		/** The account's display line for the dialog header. */
		get label() {
			const a = account();
			return a ? a.username || a.name || '' : '';
		},
		graphToken(force = false) {
			return token(GRAPH_SCOPES, { force, reason: 'Microsoft needs you to confirm access to your OneDrive files.' });
		},
		pickerToken(command) {
			return token(pickerTokenScopes(command, { consumer: isConsumerAccount(account()) }), {
				reason: 'Microsoft needs you to confirm access to your SharePoint files.',
			});
		},
		/** Picker host: onedrive.live.com for personal accounts, the tenant's -my.sharepoint.com for work. */
		async pickerBase() {
			if (pickerBase) return pickerBase;
			if (isConsumerAccount(account())) return (pickerBase = CONSUMER_PICKER_BASE);
			const res = await graphRequest(`${GRAPH_BASE}/me/drive?$select=webUrl,driveType`, {
				fetch: window.fetch.bind(window),
				getToken: (f) => this.graphToken(f),
			});
			const drive = await res.json();
			return (pickerBase = businessPickerBase(drive.webUrl));
		},
		/** Forget the account in this tab so the next sign-in shows the account chooser. */
		async forget() {
			await init();
			const a = account();
			pickerBase = null;
			if (a) await pca.clearCache({ account: a });
		},
	};
}

/**
 * Load File Picker v8 into `iframe` and resolve with the picked items, or
 * null when the person closes it. `onReady` fires once the picker page has
 * rendered (the `page-loaded` notification).
 *
 * @param {{
 *   session: ReturnType<typeof createOneDriveSession>,
 *   iframe: HTMLIFrameElement,
 *   mode: 'files'|'folders',
 *   maximumCount?: number,
 *   onReady?: () => void,
 *   signal?: AbortSignal,
 * }} o
 */
export async function runPicker({ session, iframe, mode, maximumCount = 1, onReady = () => {}, signal }) {
	const base = await session.pickerBase();
	const consumer = session.consumer;
	const formToken = await session.pickerToken({ resource: base, type: 'SharePoint', command: 'authenticate' });
	const channelId = crypto.randomUUID();
	const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark';
	const options = buildPickerOptions({ channelId, origin: location.origin, mode, consumer, maximumCount, theme });
	const locale = (document.documentElement.lang || navigator.language || 'en-us').toLowerCase();

	return new Promise((resolve, reject) => {
		let port = null;
		let settled = false;
		const initTimer = setTimeout(
			() => finish(null, new OneDriveError('picker_timeout', 'The OneDrive picker did not load. Check your connection, then try again.')),
			PICKER_INIT_TIMEOUT_MS,
		);

		function finish(value, error) {
			if (settled) return;
			settled = true;
			clearTimeout(initTimer);
			window.removeEventListener('message', onWindowMessage);
			signal?.removeEventListener?.('abort', onAbort);
			if (port) {
				port.onmessage = null;
				port.close();
			}
			if (error) reject(error);
			else resolve(value);
		}
		function onAbort() {
			finish(null);
		}

		const handle = createPickerChannel({
			post: (msg) => port?.postMessage(msg),
			getToken: (command) => session.pickerToken(command),
			onPick: (items) => finish(items),
			onClose: () => finish(null),
			onReady,
		});

		function onWindowMessage(event) {
			if (!isPickerInitialize(event, { channelId, expectedSource: iframe.contentWindow })) return;
			clearTimeout(initTimer);
			port = event.ports[0];
			port.onmessage = (e) => {
				handle(e.data).catch((err) => finish(null, err));
			};
			port.start();
			port.postMessage({ type: 'activate' });
		}

		window.addEventListener('message', onWindowMessage);
		signal?.addEventListener?.('abort', onAbort, { once: true });

		// POST the configuration into the frame. The access_token field is
		// required when the picker is embedded rather than in a popup.
		const form = document.createElement('form');
		form.method = 'POST';
		form.action = pickerActionUrl(base, options, locale);
		form.target = iframe.name;
		form.hidden = true;
		const input = document.createElement('input');
		input.type = 'hidden';
		input.name = 'access_token';
		input.value = formToken;
		form.appendChild(input);
		document.body.appendChild(form);
		form.submit();
		form.remove();
	});
}
