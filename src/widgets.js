// Client helpers for /api/widgets. Mirrors src/account.js.
// All write calls send credentials so the session cookie travels with them.
// getWidget() is public — no credentials, so cached CDN responses can be
// shared between visitors loading the same embed URL.

const API = '';

export async function listWidgets({ limit, cursor } = {}) {
	const url = new URL(`${API}/api/widgets`, location.origin);
	if (limit)  url.searchParams.set('limit', String(limit));
	if (cursor) url.searchParams.set('cursor', cursor);
	const res = await fetch(url.pathname + url.search, { credentials: 'include' });
	if (res.status === 401) throw err401();
	if (!res.ok) throw await asError(res);
	return res.json();
}

export async function getWidget(id) {
	if (!id) throw new Error('widget id required');
	const res = await fetch(`${API}/api/widgets/${encodeURIComponent(id)}`);
	if (res.status === 404) {
		const e = new Error('widget not found');
		e.code = 'not_found';
		e.status = 404;
		throw e;
	}
	if (!res.ok) throw await asError(res);
	const { widget } = await res.json();
	return widget;
}

export async function createWidget({ type, name, avatar_id, config, is_public }) {
	const data = await postJson('/api/widgets', { type, name, avatar_id, config, is_public });
	return data.widget;
}

export async function updateWidget(id, patch) {
	if (!id) throw new Error('widget id required');
	const res = await fetch(`${API}/api/widgets/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(patch),
	});
	if (res.status === 401) throw err401();
	if (!res.ok) throw await asError(res);
	const { widget } = await res.json();
	return widget;
}

export async function deleteWidget(id) {
	if (!id) throw new Error('widget id required');
	const res = await fetch(`${API}/api/widgets/${encodeURIComponent(id)}`, {
		method: 'DELETE',
		credentials: 'include',
	});
	if (res.status === 401) throw err401();
	if (!res.ok) throw await asError(res);
	return true;
}

async function postJson(path, body) {
	const res = await fetch(`${API}${path}`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (res.status === 401) throw err401();
	if (!res.ok) throw await asError(res);
	return res.json();
}

async function asError(res) {
	let data = null;
	try { data = await res.json(); } catch {}
	const e = new Error(data?.error_description || res.statusText || 'request failed');
	e.status = res.status;
	e.code   = data?.error || 'request_failed';
	e.data   = data;
	return e;
}

function err401() {
	const e = new Error('not_signed_in');
	e.status = 401;
	e.code = 'not_signed_in';
	return e;
}
