// Lightweight client helpers for talking to the three.ws backend from the viewer.
// Keeps the UI code in app.js/avatar-creator.js clean.

const API = ''; // same origin

// Wrapped fetch that handles expired sessions centrally. A 401 response is
// treated as a session-expiry signal and redirects to /login?next=<current>
// with the URL hash preserved (SPAs lose it on a naked location.href hop).
// Pass allowAnonymous:true for endpoints where a 401 is a legitimate
// "not signed in" answer the caller wants to inspect itself (e.g. /api/auth/me).
export async function apiFetch(path, options = {}) {
	const { allowAnonymous = false, ...init } = options;
	const res = await fetch(path, {
		credentials: 'include',
		...init,
	});
	if (res.status === 401 && !allowAnonymous) {
		redirectToLogin();
		const err = new Error('session expired');
		err.status = 401;
		err.redirected = true;
		throw err;
	}
	return res;
}

function redirectToLogin() {
	if (typeof location === 'undefined') return;
	// Don't loop if we're already on the login page.
	if (/^\/login(\/|$|\?)/.test(location.pathname)) return;
	const next = location.pathname + location.search + location.hash;
	location.href = '/login?next=' + encodeURIComponent(next);
}

// Optimistic auth hint — non-authoritative, used only for first-paint gating
// on the viewer. The real session cookie is HttpOnly so we can't read it
// synchronously; this hint lets us avoid a visible flash between "pending"
// and the resolved state for returning users. Always revalidated by getMe().
const AUTH_HINT_KEY = '3dagent:auth-hint';
const AUTH_HINT_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7d

export function readAuthHint() {
	try {
		const raw = localStorage.getItem(AUTH_HINT_KEY);
		if (!raw) return null;
		const { authed, ts } = JSON.parse(raw);
		if (!ts || Date.now() - ts > AUTH_HINT_TTL_MS) return null;
		return authed ? 'true' : 'false';
	} catch {
		return null;
	}
}

function writeAuthHint(authed) {
	try {
		localStorage.setItem(AUTH_HINT_KEY, JSON.stringify({ authed: !!authed, ts: Date.now() }));
	} catch {
		/* quota or disabled storage */
	}
}

export function clearAuthHint() {
	try {
		localStorage.removeItem(AUTH_HINT_KEY);
	} catch {
		/* ignore */
	}
}

export async function getMe() {
	// /api/auth/me 401s for anonymous visitors by design — handle in place.
	const res = await apiFetch(`${API}/api/auth/me`, { allowAnonymous: true });
	if (res.status === 401) {
		writeAuthHint(false);
		return null;
	}
	if (!res.ok) throw new Error(`auth/me failed: ${res.status}`);
	const user = (await res.json()).user;
	writeAuthHint(!!user);
	return user;
}

// Uploads a GLB to our R2 bucket and creates the avatar record.
// `source` may be a Blob (from CharacterStudio postMessage) or a URL string.
// Throws if the user isn't authenticated.
export async function saveRemoteGlbToAccount(source, meta = {}) {
	const user = await getMe();
	if (!user) {
		const err = new Error('not_signed_in');
		err.code = 'not_signed_in';
		throw err;
	}

	let blob;
	if (source instanceof Blob) {
		blob = source;
	} else {
		const resp = await fetch(source, { mode: 'cors' });
		if (!resp.ok) throw new Error(`failed to fetch source GLB: ${resp.status}`);
		blob = await resp.blob();
	}

	const size = blob.size;
	const contentType = blob.type || 'model/gltf-binary';
	const checksum = await sha256Hex(blob);

	const presign = await postJson('/api/avatars/presign', {
		size_bytes: size,
		content_type: contentType,
		checksum_sha256: checksum,
	});

	const putRes = await fetch(presign.upload_url, {
		method: 'PUT',
		headers: { 'content-type': contentType },
		body: blob,
	});
	if (!putRes.ok) throw new Error(`R2 upload failed: ${putRes.status}`);

	const sourceMeta =
		meta.source_meta ||
		(typeof source === 'string' ? { source_url: source } : { generator: 'characterstudio' });

	const created = await postJson('/api/avatars', {
		storage_key: presign.storage_key,
		size_bytes: size,
		content_type: contentType,
		checksum_sha256: checksum,
		name: meta.name || deriveAvatarName(source, checksum),
		description: meta.description,
		visibility: meta.visibility || 'private',
		tags: meta.tags || [],
		source: meta.source || 'upload',
		source_meta: sourceMeta,
	});
	return created.avatar;
}

async function postJson(path, body) {
	const res = await apiFetch(`${API}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = res.headers.get('content-type')?.includes('application/json')
		? await res.json()
		: null;
	if (!res.ok)
		throw Object.assign(new Error(data?.error_description || res.statusText), {
			status: res.status,
			data,
		});
	return data;
}

async function sha256Hex(blob) {
	const buf = await blob.arrayBuffer();
	const hash = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function deriveAvatarName(source, checksum) {
	if (source && typeof source === 'object' && typeof source.name === 'string') {
		const base = source.name.replace(/\.(glb|gltf)$/i, '').trim();
		if (base) return base.slice(0, 80);
	}
	if (typeof source === 'string') {
		try {
			const file = new URL(source).pathname.split('/').pop() || '';
			const base = file.replace(/\.(glb|gltf)$/i, '').trim();
			if (base) return base.slice(0, 80);
		} catch {
			/* ignore non-URL strings */
		}
	}
	return `Avatar #${checksum.slice(0, 6)}`;
}
