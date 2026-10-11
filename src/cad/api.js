// CAD Forge page: the client side of /api/cad.

export class CadApiError extends Error {
	constructor(status, body) {
		super(body?.message || `Request failed (${status})`);
		this.status = status;
		this.code = body?.error || 'request_failed';
		this.body = body || {};
	}
}

async function readJsonResponse(res) {
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new CadApiError(res.status, body);
	return body;
}

export async function fetchDesign(id, variantKey = null) {
	const qs = new URLSearchParams({ id });
	if (variantKey) qs.set('v', variantKey);
	return readJsonResponse(await fetch(`/api/cad?${qs}`));
}

export async function fetchGallery({ scope = 'recent', limit = 24, q = '' } = {}) {
	const qs = new URLSearchParams({ list: scope, limit: String(limit) });
	if (q) qs.set('q', q);
	return readJsonResponse(await fetch(`/api/cad?${qs}`));
}

export async function rebuildDesign(id, values, { signal } = {}) {
	const res = await fetch('/api/cad', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ action: 'rebuild', id, values }),
		signal,
	});
	return readJsonResponse(res);
}

/**
 * Generate (or refine) a design, streaming real progress.
 * onStage receives { stage, attempt, error? } as the server reports it.
 * Resolves with { design, attempts }; rejects with CadApiError.
 */
export async function generateDesign({ prompt, parentId = null, values = null, onStage = () => {}, signal } = {}) {
	const res = await fetch('/api/cad', {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
		body: JSON.stringify({ action: 'generate', prompt, parentId, values, stream: true }),
		signal,
	});
	const type = res.headers.get('content-type') || '';
	if (!type.includes('text/event-stream')) return readJsonResponse(res);

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let boundary;
		while ((boundary = buffer.indexOf('\n\n')) !== -1) {
			const frame = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			const event = /^event: (.+)$/m.exec(frame)?.[1];
			const data = /^data: (.+)$/m.exec(frame)?.[1];
			if (!event || !data) continue;
			const payload = JSON.parse(data);
			if (event === 'stage') onStage(payload);
			else if (event === 'done') return payload;
			else if (event === 'error') throw new CadApiError(payload.status || 502, payload);
		}
	}
	throw new CadApiError(502, { error: 'stream_ended', message: 'The connection closed before the part finished. Try again.' });
}
