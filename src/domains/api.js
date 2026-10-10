// Client for /api/domains. Every call returns parsed JSON or throws an Error
// whose `code` and `status` come from the API's error envelope.

async function request(path, { method = 'GET', body } = {}) {
	const res = await fetch(`/api/domains/${path}`, {
		method,
		credentials: 'include',
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(data.error_description || data.message || `Request failed (${res.status})`);
		err.status = res.status;
		err.code = data.error || 'request_failed';
		err.detail = data.detail;
		throw err;
	}
	return data;
}

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

export const domainsApi = {
	search: (q, tlds) => request(`search?${qs({ q, tlds: tlds?.join(',') })}`),
	check: (domain) => request(`check?${qs({ domain })}`),
	suggest: (name) => request(`suggest?${qs({ name })}`),
	pricing: (params = {}) => request(`pricing?${qs(params)}`),
	quota: () => request('quota'),
	list: () => request('list'),
	quote: (body) => request('quote', { method: 'POST', body }),
	register: (body) => request('register', { method: 'POST', body }),
	status: (id) => request(`status?${qs({ id })}`),
	connect: (body) => request('connect', { method: 'POST', body }),
	connectStatus: (domain) => request(`connect-status?${qs({ domain })}`),
};

export const fmtUsd = (n) => (n == null ? '' : `$${Number(n).toFixed(2)}`);

export function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
