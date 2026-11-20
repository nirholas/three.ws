// Per-creation manage tokens (issue #639), kept in this browser.
//
// Every /api/forge response that names a creation carries its `manage_token`:
// a credential that lets the maker delete the model or change who sees it
// without the x-forge-client id it was forged under. /forge records each one
// here and the model page (/m/:id) sends it back as x-forge-manage-token, so a
// maker keeps control of a model even if the browser id is ever regenerated.
//
// Tokens are scoped to one creation and only grant management of it, so they
// live beside the browser id in localStorage. The map is capped so a heavy
// user's storage stays small; the oldest entries go first.

const KEY = 'forge:manage';
const MAX_ENTRIES = 500;
const TOKEN_RE = /^fm1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function read() {
	try {
		const raw = localStorage.getItem(KEY);
		const map = raw ? JSON.parse(raw) : null;
		return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
	} catch {
		return {};
	}
}

function write(map) {
	try {
		const ids = Object.keys(map);
		if (ids.length > MAX_ENTRIES) {
			ids.sort((a, b) => (map[a]?.at || 0) - (map[b]?.at || 0));
			for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete map[id];
		}
		localStorage.setItem(KEY, JSON.stringify(map));
	} catch {
		// Storage blocked or full: the browser id still authorizes the maker.
	}
}

/** Remember the token a forge response carried. Ignores anything malformed. */
export function rememberManageToken(creationId, token) {
	if (!creationId || !UUID_RE.test(creationId) || typeof token !== 'string' || !TOKEN_RE.test(token)) return;
	const map = read();
	if (map[creationId]?.token === token) return;
	map[creationId] = { token, at: Date.now() };
	write(map);
}

/** Pull creation_id + manage_token out of any forge response body. */
export function rememberFromResponse(body) {
	if (body && typeof body === 'object') rememberManageToken(body.creation_id, body.manage_token);
}

/** The stored token for a creation, or null. */
export function manageTokenFor(creationId) {
	if (!creationId) return null;
	const token = read()[creationId]?.token;
	return typeof token === 'string' && TOKEN_RE.test(token) ? token : null;
}

/** Drop a creation's token (after it is deleted). */
export function forgetManageToken(creationId) {
	const map = read();
	if (!(creationId in map)) return;
	delete map[creationId];
	write(map);
}

/** Headers that carry the stored token for a creation, if there is one. */
export function manageHeaders(creationId) {
	const token = manageTokenFor(creationId);
	return token ? { 'x-forge-manage-token': token } : {};
}
