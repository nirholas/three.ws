// A small Server-Sent Events reader over a fetch Response body, for the chat
// and run streams. Handles both frame styles the platform emits: data-only
// frames carrying a JSON `type` (POST /api/chat) and named `event:` frames
// (the v1 run stream). Comment lines (`: tool swap_quote`) are surfaced too,
// because /api/agent/run reports tool activity that way.

export function createSseParser(onEvent) {
	let buffer = '';
	let event = null;
	let data = [];

	function dispatch() {
		if (!data.length && !event) return;
		const raw = data.join('\n');
		let json = null;
		try {
			json = raw ? JSON.parse(raw) : null;
		} catch {
			json = null;
		}
		onEvent({ event: event || 'message', data: raw, json });
		event = null;
		data = [];
	}

	function line(l) {
		if (l === '') return dispatch();
		if (l.startsWith(':')) {
			onEvent({ event: 'comment', data: l.slice(1).trim(), json: null });
			return;
		}
		const idx = l.indexOf(':');
		const field = idx === -1 ? l : l.slice(0, idx);
		let value = idx === -1 ? '' : l.slice(idx + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'event') event = value;
		else if (field === 'data') data.push(value);
	}

	return {
		push(chunk) {
			buffer += chunk;
			let nl;
			while ((nl = buffer.search(/\r\n|\n|\r/)) !== -1) {
				const l = buffer.slice(0, nl);
				buffer = buffer.slice(nl + (buffer[nl] === '\r' && buffer[nl + 1] === '\n' ? 2 : 1));
				line(l);
			}
		},
		end() {
			if (buffer) line(buffer);
			buffer = '';
			dispatch();
		},
	};
}

export async function readSse(response, onEvent, { signal } = {}) {
	const parser = createSseParser(onEvent);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const abort = () => reader.cancel().catch(() => {});
	signal?.addEventListener('abort', abort, { once: true });
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			parser.push(decoder.decode(value, { stream: true }));
		}
		parser.end();
	} finally {
		signal?.removeEventListener('abort', abort);
	}
}
