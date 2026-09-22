// Fetch with a deadline, a User-Agent, and one error type that carries the
// server's own error code and message, so every surface prints what actually
// failed instead of "fetch failed".

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;
export const USER_AGENT = `three-ws-agent/${VERSION} (node ${process.versions.node}; ${process.platform})`;

export class ApiError extends Error {
	constructor(message, { status = 0, code = null, body = null } = {}) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

function reasonOf(err, timeoutMs) {
	if (err?.name === 'TimeoutError') return `timed out after ${Math.round(timeoutMs / 1000)}s`;
	if (err?.name === 'AbortError') return 'cancelled';
	return err?.cause?.code || err?.message || 'network error';
}

export async function request(url, { method = 'GET', headers = {}, json, body, timeoutMs = 30_000, signal } = {}) {
	const h = { 'user-agent': USER_AGENT, accept: 'application/json', ...headers };
	let payload = body;
	if (json !== undefined) {
		h['content-type'] = 'application/json';
		payload = JSON.stringify(json);
	}
	const signals = [AbortSignal.timeout(timeoutMs)];
	if (signal) signals.push(signal);
	try {
		return await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.any(signals) });
	} catch (err) {
		throw new ApiError(`could not reach ${new URL(url).host}: ${reasonOf(err, timeoutMs)}`, { code: err?.name === 'AbortError' ? 'aborted' : 'network' });
	}
}

/** Pull `{ code, message }` out of any of the error shapes three.ws and OpenAI-compatible hosts return. */
export function errorOf(data, text, res) {
	const e = data?.error;
	const code = typeof e === 'string' ? e : e?.code || e?.type || null;
	const message =
		(typeof e === 'object' && e?.message) || data?.error_description || data?.message || (text || '').slice(0, 300) || res?.statusText || 'request failed';
	return { code, message };
}

export async function requestJson(url, opts = {}) {
	const res = await request(url, opts);
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = null;
	}
	if (!res.ok) {
		const { code, message } = errorOf(data, text, res);
		throw new ApiError(`${res.status} ${code ? `${code}: ` : ''}${message}`, { status: res.status, code, body: data });
	}
	return data;
}
