// three.ws sign-in prompt for creation endpoints.
//
// Making or uploading anything on three.ws needs an account: every creation
// endpoint answers an anonymous caller with 401 `{ error: "sign_in_required" }`
// (api/_lib/creator-account.js). Dozens of pages call those endpoints, and most
// would otherwise show that refusal as a generic failure. This watches
// same-origin fetches site-wide and, on that exact refusal, shows one banner
// with the server's message and a sign-in link that returns to this page.
// public/nav.js loads this on every page with the site nav; a full-screen tool
// without the nav loads it itself with <script src="/sign-in-watch.js" defer>.
// A page with its own designed prompt for some endpoints (the Forge pages, via
// src/shared/upload-sign-in.js) lists those API paths, space-separated, in
// `data-sign-in-prompt` on <html>, and the banner stays out of their way for
// those calls only. A page that knew the visitor was signed in when it loaded
// sets `data-session-signed-in="1"` on <html>, and the banner then says the
// session ended rather than repeating that the action needs an account. The
// response itself reaches the caller untouched; only a clone is read, and only
// on a 401.
(function watchSignInRequired() {
	if (typeof window === 'undefined' || typeof window.fetch !== 'function' || window.__twsSignInWatch) return;
	window.__twsSignInWatch = true;
	const nativeFetch = window.fetch;

	// The request's path when it is same-origin, else null.
	function sameOriginPath(input) {
		try {
			const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input && input.url, location.href);
			return url.origin === location.origin ? url.pathname : null;
		} catch (_) {
			return null;
		}
	}

	function handledInPage(path) {
		const list = document.documentElement.dataset.signInPrompt;
		return Boolean(list) && list.split(/\s+/).includes(path);
	}

	function injectStyle() {
		if (document.getElementById('tws-signin-banner-style')) return;
		const style = document.createElement('style');
		style.id = 'tws-signin-banner-style';
		style.textContent = [
			'.tws-signin-banner{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147483000;',
			'display:flex;align-items:center;gap:12px;max-width:min(560px,calc(100vw - 32px));box-sizing:border-box;padding:12px 14px 12px 16px;',
			'border-radius:12px;border:1px solid var(--line,rgba(255,255,255,.14));background:var(--surface,#15171c);color:var(--ink,#f2f3f5);',
			'box-shadow:0 10px 30px rgba(0,0,0,.35);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}',
			'.tws-signin-banner p{margin:0;flex:1}',
			'.tws-signin-banner a{flex:none;padding:7px 14px;border-radius:8px;background:var(--accent,#f2f3f5);color:var(--accent-ink,#111);font-weight:600;text-decoration:none;transition:filter .15s,transform .15s}',
			'.tws-signin-banner a:hover{filter:brightness(1.08)}',
			'.tws-signin-banner a:active{transform:translateY(1px)}',
			'.tws-signin-banner button{flex:none;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer;opacity:.7;transition:opacity .15s,background .15s}',
			'.tws-signin-banner button:hover{opacity:1;background:rgba(127,127,127,.18)}',
			'.tws-signin-banner button:active{background:rgba(127,127,127,.28)}',
			'.tws-signin-banner a:focus-visible,.tws-signin-banner button:focus-visible{outline:2px solid var(--accent,#f2f3f5);outline-offset:2px}',
		].join('');
		document.head.appendChild(style);
	}

	function showBanner(message) {
		injectStyle();
		let banner = document.getElementById('tws-signin-banner');
		if (!banner) {
			banner = document.createElement('div');
			banner.id = 'tws-signin-banner';
			banner.className = 'tws-signin-banner';
			banner.setAttribute('role', 'status');
			banner.setAttribute('aria-live', 'polite');
			const text = document.createElement('p');
			const link = document.createElement('a');
			link.textContent = 'Sign in';
			const close = document.createElement('button');
			close.type = 'button';
			close.setAttribute('aria-label', 'Dismiss');
			close.textContent = '×';
			close.addEventListener('click', () => banner.remove());
			banner.append(text, link, close);
			document.body.appendChild(banner);
		}
		const sessionEnded = document.documentElement.dataset.sessionSignedIn === '1';
		banner.querySelector('p').textContent = sessionEnded
			? 'Your session ended, so that did not go through. Sign in again and you come straight back here.'
			: message || 'Sign in to do that. A three.ws account is free.';
		banner.querySelector('a').href = '/login?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
	}

	window.fetch = function fetchWithSignInWatch(input, init) {
		const pending = nativeFetch.apply(window, arguments);
		const path = sameOriginPath(input);
		if (!path || handledInPage(path)) return pending;
		pending
			.then((res) => {
				if (res.status !== 401) return;
				if (!String(res.headers.get('content-type') || '').includes('json')) return;
				return res
					.clone()
					.json()
					.then((body) => {
						if (body && body.error === 'sign_in_required') showBanner(body.message);
					});
			})
			.catch(() => {});
		return pending;
	};
})();
