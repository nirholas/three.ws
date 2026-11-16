// Send a browser that is half signed in to the two-step verification page.
//
// When an account has two-step verification on, every sign-in path (password,
// Google, X, GitHub, Telegram, wallets, SAML, Microsoft without Entra MFA)
// leaves a PENDING session cookie: its token starts with `mfa_`
// (api/_lib/account-mfa.js PENDING_PREFIX). The password form handles that
// itself, but redirect-based sign-ins (OAuth callbacks) land straight on a
// page. This middleware catches those page loads and sends them to
// /login/verify?next=<where they were going>, with no database read: the
// prefix alone says the session is pending. APIs are not redirected; they
// already treat a pending session as signed out.
//
// Shared by the Cloud Run server (server/index.mjs) and the Vite dev server
// (vite.config.js) so both behave the same. Tested in tests/mfa-gate.test.js.

const COOKIE_RE = /(?:^|;\s*)(?:__Host-sid|sid)=mfa_[^;]*/;
const PASS_PREFIXES = ['/api/', '/login', '/logout', '/src/', '/assets/', '/@', '/node_modules/', '/fonts/', '/favicon'];
const ASSET_RE = /\.(?:js|mjs|css|map|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|glb|gltf|bin|wasm|txt|xml|webmanifest)$/i;

/** True when this request is a page navigation that carries a pending sign-in. */
export function needsMfaRedirect(req) {
	if (req.method !== 'GET' && req.method !== 'HEAD') return false;
	const cookie = req.headers?.cookie;
	if (!cookie || !COOKIE_RE.test(cookie)) return false;
	const url = req.originalUrl || req.url || '/';
	const path = url.split('?')[0];
	if (PASS_PREFIXES.some((p) => path.startsWith(p))) return false;
	if (path.startsWith('/.well-known/') || ASSET_RE.test(path)) return false;
	const accept = String(req.headers.accept || '');
	const dest = String(req.headers['sec-fetch-dest'] || '');
	return dest === 'document' || (!dest && accept.includes('text/html'));
}

export function mfaRedirectLocation(req) {
	const url = req.originalUrl || req.url || '/';
	return `/login/verify?next=${encodeURIComponent(url)}`;
}

/** Connect/Express middleware. */
export function mfaGateMiddleware() {
	return (req, res, next) => {
		if (!needsMfaRedirect(req)) return next();
		res.statusCode = 302;
		res.setHeader('location', mfaRedirectLocation(req));
		res.setHeader('cache-control', 'no-store');
		res.end();
	};
}
