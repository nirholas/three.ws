// Thin fetch wrappers. Node 20's global fetch is the HTTP client; these only add
// a deadline, a User-Agent, and one error type that carries the server's own
// `error` / `error_description` so every command can print what actually failed.

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;
export const USER_AGENT = `three-ws-cli/${VERSION} (node ${process.versions.node}; ${process.platform})`;

export class ApiError extends Error {
	constructor(message, { status = 0, code = null, body = null } = {}) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

export async function request(url, { method = 'GET', headers = {}, body, form, json, timeoutMs = 20_000 } = {}) {
	const h = { 'user-agent': USER_AGENT, accept: 'application/json', ...headers };
	let payload = body;
	if (json !== undefined) {
		h['content-type'] = 'application/json';
		payload = JSON.stringify(json);
	} else if (form !== undefined) {
		h['content-type'] = 'application/x-www-form-urlencoded';
		payload = new URLSearchParams(form).toString();
	}
	let res;
	try {
		res = await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
	} catch (err) {
		const reason = err?.name === 'TimeoutError' ? `timed out after ${Math.round(timeoutMs / 1000)}s` : err?.cause?.code || err?.message || 'network error';
		throw new ApiError(`could not reach ${new URL(url).host}: ${reason}`);
	}
	return res;
}

/** Request and parse JSON; throws ApiError on any non-2xx with the server's reason. */
export async function requestJson(url, opts = {}) {
	const res = await request(url, opts);
	const text = await res.text();
	let data = null;
	try { data = text ? JSON.parse(text) : null; } catch { data = null; }
	if (!res.ok) {
		const code = data?.error && typeof data.error === 'string' ? data.error : data?.error?.code || null;
		const desc = data?.error_description || data?.error?.message || data?.message || text.slice(0, 200) || res.statusText;
		throw new ApiError(`${res.status} ${code ? `${code}: ` : ''}${desc}`, { status: res.status, code, body: data });
	}
	return data;
}
