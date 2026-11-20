// Server-sent events, read and written by the same module on both sides:
// the Node server parses xAI's stream with it, and the page parses the
// server's stream with it. Spec: https://html.spec.whatwg.org/multipage/server-sent-events.html

/**
 * An incremental SSE parser. Feed it text in chunks of any size (a chunk may
 * end in the middle of a line or of a CRLF pair); it calls onEvent once per
 * complete event with { event, data, id }.
 */
export function createSSEParser(onEvent) {
	let buffer = '';
	let event = '';
	let data = [];
	let id = '';

	function dispatch() {
		if (data.length) onEvent({ event: event || 'message', data: data.join('\n'), id });
		event = '';
		data = [];
	}

	function line(raw) {
		if (raw === '') return dispatch();
		if (raw.startsWith(':')) return;
		const colon = raw.indexOf(':');
		const field = colon === -1 ? raw : raw.slice(0, colon);
		let value = colon === -1 ? '' : raw.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'data') data.push(value);
		else if (field === 'event') event = value;
		else if (field === 'id') id = value;
	}

	return {
		push(chunk) {
			buffer += chunk;
			for (;;) {
				const index = buffer.search(/\r\n|\r|\n/);
				if (index === -1) return;
				// A trailing lone CR may be the first half of a CRLF split across chunks.
				if (buffer[index] === '\r' && index === buffer.length - 1) return;
				const width = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
				line(buffer.slice(0, index));
				buffer = buffer.slice(index + width);
			}
		},
		end() {
			if (buffer) line(buffer.replace(/\r$/, ''));
			buffer = '';
			dispatch();
		},
	};
}

/** Every event in a byte stream (a fetch Response body), in order. */
export async function* readSSE(body) {
	const reader = body.pipeThrough(new TextDecoderStream()).getReader();
	const queue = [];
	const parser = createSSEParser((evt) => queue.push(evt));
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			parser.push(value);
			while (queue.length) yield queue.shift();
		}
		parser.end();
		while (queue.length) yield queue.shift();
	} finally {
		reader.cancel().catch(() => {});
	}
}

/** One event in wire format. */
export function formatSSE(event, data) {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
