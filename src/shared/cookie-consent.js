// Cookie and analytics consent for three.ws.
//
// PostHog (product analytics + session replay) is the only non-essential
// storage the site uses. It must not run, set cookies, or record anything until
// the visitor accepts. The inline loader in vite.config.js installs the PostHog
// stub and a `window.__threewsStartAnalytics` function but does NOT call
// posthog.init(); this module calls it after an explicit "accept".
//
// Rules:
//   - Accept and Reject carry equal visual weight. Customize is optional.
//   - Global Privacy Control and Do Not Track count as a reject until the visitor
//     makes an explicit choice (an explicit choice always wins).
//   - The choice lives in localStorage under CONSENT_KEY and is changeable at any
//     time through window.threewsConsent.open() (the footer "Cookie settings").
//   - Rejecting wipes every ph_* cookie and localStorage key PostHog wrote.
//   - Changes fire a `threews:consent` CustomEvent on window.
//
// The state logic below is pure and unit tested (tests/cookie-consent.test.js);
// the banner is DOM glue around it.

export const CONSENT_KEY = 'threews:cookie-consent';
export const CONSENT_EVENT = 'threews:consent';
const VALID = new Set(['granted', 'denied']);

export function readConsent(storage) {
	try {
		const raw = storage?.getItem(CONSENT_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || !VALID.has(parsed.analytics)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function writeConsent(storage, status) {
	try {
		storage?.setItem(
			CONSENT_KEY,
			JSON.stringify({ analytics: status, ts: new Date().toISOString(), v: 1 }),
		);
	} catch {
		/* storage blocked: the choice holds for this page view only */
	}
}

/** 'gpc' | 'dnt' | null. Browser-level opt-out signals. */
export function optOutSignal(nav) {
	if (nav?.globalPrivacyControl === true) return 'gpc';
	const dnt = nav?.doNotTrack ?? nav?.msDoNotTrack;
	if (dnt === '1' || dnt === 'yes') return 'dnt';
	return null;
}

/** @returns {{ status: 'granted'|'denied'|'unset', source: 'user'|'gpc'|'dnt'|null }} */
export function resolveConsent(storage, nav) {
	const stored = readConsent(storage);
	if (stored) return { status: stored.analytics, source: 'user' };
	const signal = optOutSignal(nav);
	if (signal) return { status: 'denied', source: signal };
	return { status: 'unset', source: null };
}

export function createConsentStore({ storage, navigator: nav }) {
	let state = resolveConsent(storage, nav);
	const listeners = new Set();
	return {
		get: () => state,
		set(status) {
			if (!VALID.has(status)) throw new Error(`Invalid consent status: ${status}`);
			writeConsent(storage, status);
			const changed = state.status !== status;
			state = { status, source: 'user' };
			if (changed) for (const fn of listeners) fn(state);
		},
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	};
}

function isPosthogKey(name) {
	return name.startsWith('ph_') || name.startsWith('__ph_');
}

function wipePosthogStorage(storage, doc) {
	try {
		const keys = [];
		for (let i = 0; i < (storage?.length ?? 0); i++) {
			const k = storage.key(i);
			if (k && isPosthogKey(k)) keys.push(k);
		}
		for (const k of keys) storage.removeItem(k);
	} catch {
		/* storage blocked */
	}
	try {
		if (!doc) return;
		for (const part of String(doc.cookie || '').split(';')) {
			const name = part.split('=')[0].trim();
			if (!name || !isPosthogKey(name)) continue;
			doc.cookie = `${name}=; Max-Age=0; Path=/`;
			const host = typeof location !== 'undefined' ? location.hostname : '';
			if (host) doc.cookie = `${name}=; Max-Age=0; Path=/; Domain=${host}`;
		}
	} catch {
		/* cookies blocked */
	}
}

/** Make PostHog match the consent status. Safe when PostHog never loaded. */
export function applyToPosthog(status, win, storage, doc) {
	const ph = win?.posthog;
	try {
		if (status === 'granted') {
			if (ph?.__loaded && typeof ph.opt_in_capturing === 'function') ph.opt_in_capturing();
			if (typeof win.__threewsStartAnalytics === 'function') win.__threewsStartAnalytics();
		} else if (status === 'denied') {
			if (ph?.__loaded) {
				if (typeof ph.opt_out_capturing === 'function') ph.opt_out_capturing();
				if (typeof ph.stopSessionRecording === 'function') ph.stopSessionRecording();
			}
			wipePosthogStorage(storage, doc);
		}
	} catch {
		/* analytics must never break the page */
	}
}

// ---------------------------------------------------------------------------
// The banner itself, which only ever renders in a browser.
// ---------------------------------------------------------------------------

const STYLE = `
.tw-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;padding:18px 20px;border-radius:14px;background:#121218;color:#ececf1;border:1px solid #34343f;box-shadow:0 12px 40px rgba(0,0,0,.5);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.tw-consent[hidden]{display:none}
.tw-consent h2{margin:0 0 6px;font-size:15px;font-weight:600;color:#fff}
.tw-consent p{margin:0 0 12px;color:#c4c4cf}
.tw-consent a{color:#9ec5ff;text-decoration:underline}
.tw-consent a:focus-visible,.tw-consent button:focus-visible,.tw-consent input:focus-visible{outline:2px solid #9ec5ff;outline-offset:2px}
.tw-consent-row{display:flex;flex-wrap:wrap;gap:10px}
.tw-consent button{flex:1 1 120px;min-height:40px;padding:8px 14px;border-radius:10px;border:1px solid #5a5a6b;background:#1d1d27;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;transition:background .15s,border-color .15s,transform .05s}
.tw-consent button:hover{background:#2a2a37;border-color:#8a8a9d}
.tw-consent button:active{transform:translateY(1px)}
.tw-consent-detail{margin:0 0 12px;padding:12px;border-radius:10px;background:#1a1a23;border:1px solid #2c2c38}
.tw-consent-detail label{display:flex;gap:10px;align-items:flex-start;margin:0 0 8px;color:#e4e4ec}
.tw-consent-detail input{margin-top:3px;width:16px;height:16px;accent-color:#9ec5ff}
.tw-consent-detail small{display:block;color:#a4a4b2}
@media (prefers-reduced-motion:reduce){.tw-consent button{transition:none}}
`;

function mountBanner(store) {
	const doc = document;
	let root = null;
	let returnFocus = null;

	function build() {
		if (!doc.getElementById('tw-consent-style')) {
			const st = doc.createElement('style');
			st.id = 'tw-consent-style';
			st.textContent = STYLE;
			doc.head.appendChild(st);
		}
		root = doc.createElement('div');
		root.className = 'tw-consent';
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-modal', 'false');
		root.setAttribute('aria-labelledby', 'tw-consent-title');
		root.setAttribute('aria-describedby', 'tw-consent-desc');
		root.hidden = true;
		root.innerHTML = `
			<h2 id="tw-consent-title">Cookies and analytics</h2>
			<p id="tw-consent-desc">With your permission we use PostHog for product analytics and session replay to find bugs and improve three.ws. It sets cookies and records how you use the site. Nothing is collected until you accept, and sign-in cookies are essential and always on. See the <a href="/legal/privacy#cookies">Privacy Policy</a>.</p>
			<div class="tw-consent-detail" id="tw-consent-detail" hidden>
				<label><input type="checkbox" checked disabled> <span>Essential<small>Sign-in session and security cookies. Always on.</small></span></label>
				<label><input type="checkbox" id="tw-consent-analytics"> <span>Analytics and session replay<small>PostHog. Page views, clicks, and recorded sessions. Off unless you turn it on.</small></span></label>
			</div>
			<div class="tw-consent-row">
				<button type="button" data-act="accept">Accept</button>
				<button type="button" data-act="reject">Reject</button>
				<button type="button" data-act="customize" aria-expanded="false" aria-controls="tw-consent-detail">Customize</button>
			</div>`;
		doc.body.appendChild(root);
		root.addEventListener('click', (e) => {
			const act = e.target?.closest?.('button')?.dataset?.act;
			if (!act) return;
			if (act === 'accept') choose('granted');
			else if (act === 'reject') choose('denied');
			else if (act === 'save') choose(root.querySelector('#tw-consent-analytics').checked ? 'granted' : 'denied');
			else toggleDetail();
		});
		root.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && store.get().source === 'user') close();
		});
	}

	function toggleDetail() {
		const detail = root.querySelector('#tw-consent-detail');
		const btn = root.querySelector('[data-act="customize"]');
		const check = root.querySelector('#tw-consent-analytics');
		const opening = detail.hidden;
		detail.hidden = !opening;
		btn.setAttribute('aria-expanded', String(opening));
		if (opening) {
			check.checked = store.get().status === 'granted';
			btn.textContent = 'Save choices';
			btn.dataset.act = 'save';
			check.focus();
		}
	}

	function choose(status) {
		store.set(status);
		close();
	}

	function close() {
		root.hidden = true;
		if (returnFocus && doc.contains(returnFocus)) returnFocus.focus();
		returnFocus = null;
	}

	function open() {
		if (!root) build();
		returnFocus = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
		const detail = root.querySelector('#tw-consent-detail');
		const btn = root.querySelector('[data-act="customize"], [data-act="save"]');
		detail.hidden = true;
		btn.dataset.act = 'customize';
		btn.textContent = 'Customize';
		btn.setAttribute('aria-expanded', 'false');
		root.hidden = false;
		root.querySelector('[data-act="accept"]').focus();
	}

	build();
	return { open };
}

function boot() {
	if (typeof window === 'undefined' || window.threewsConsent) return;
	let storage = null;
	try {
		storage = window.localStorage;
	} catch {
		storage = null;
	}
	const store = createConsentStore({ storage, navigator: window.navigator });
	let banner = null;
	const ensureBanner = () => (banner ||= mountBanner(store));

	store.subscribe(({ status }) => {
		applyToPosthog(status, window, storage, document);
		try {
			window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { analytics: status } }));
		} catch {
			/* old browser without CustomEvent constructor */
		}
	});

	window.threewsConsent = {
		get: () => store.get().status,
		set: (status) => store.set(status),
		open: () => ensureBanner().open(),
		onChange: (fn) => store.subscribe((s) => fn(s.status)),
	};

	const initial = store.get();
	applyToPosthog(initial.status, window, storage, document);

	// Only pages that actually run analytics (the PostHog stub is present) ask
	// unprompted. Other pages still get the footer "Cookie settings" button.
	if (initial.status === 'unset' && window.posthog) {
		const show = () => ensureBanner().open();
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
		else show();
	}
}

boot();
