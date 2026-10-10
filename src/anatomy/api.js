// Anatomy page: the client side of /api/anatomy.

export class AnatomyApiError extends Error {
	constructor(status, body) {
		super(body?.message || `Request failed (${status})`);
		this.status = status;
		this.code = body?.error || 'request_failed';
		this.body = body || {};
	}
}

async function readJsonResponse(res) {
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new AnatomyApiError(res.status, body);
	return body;
}

export async function fetchDesign(id) {
	return readJsonResponse(await fetch(`/api/anatomy?${new URLSearchParams({ id })}`));
}

export async function fetchGallery({ limit = 24, q = '' } = {}) {
	const qs = new URLSearchParams({ list: 'recent', limit: String(limit) });
	if (q) qs.set('q', q);
	return readJsonResponse(await fetch(`/api/anatomy?${qs}`));
}

/**
 * Generate a machine, streaming the spec as Claude writes it.
 *   onStage(stage)   'writing' | 'repairing' | 'saving'
 *   onText(text)     the full spec text so far (after any reset)
 * Resolves with { design, warnings }; rejects with AnatomyApiError.
 */
export async function generateDesign({ prompt, onStage = () => {}, onText = () => {}, signal } = {}) {
	const res = await fetch('/api/anatomy', {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
		body: JSON.stringify({ action: 'generate', prompt, stream: true }),
		signal,
	});
	const type = res.headers.get('content-type') || '';
	if (!type.includes('text/event-stream')) return readJsonResponse(res);

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let text = '';
	let result = null;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let idx;
		while ((idx = buffer.indexOf('\n\n')) !== -1) {
			const record = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			let event = 'message';
			let data = '';
			for (const line of record.split('\n')) {
				if (line.startsWith('event:')) event = line.slice(6).trim();
				else if (line.startsWith('data:')) data += line.slice(5).trim();
			}
			if (!data) continue;
			let payload;
			try {
				payload = JSON.parse(data);
			} catch {
				continue;
			}
			if (event === 'delta') {
				text += payload.text || '';
				onText(text);
			} else if (event === 'reset') {
				text = '';
				onText(text);
			} else if (event === 'stage') onStage(payload.stage);
			else if (event === 'done') result = payload;
			else if (event === 'error') throw new AnatomyApiError(payload.status || 500, payload);
		}
	}
	if (!result) throw new AnatomyApiError(502, { error: 'stream_ended', message: 'The connection closed before the machine finished. Try again.' });
	return result;
}
