// Bounded body readers for responses from hosts we do not control. A bare
// `res.text()` buffers the whole body; against a hostile endpoint that streams
// forever, only the request timeout would stop it. These stop at the cap and
// cancel the stream.

// Read at most `maxBytes` and return them as UTF-8 text. The rest of the body is
// discarded (stream cancelled). `truncated` is true when bytes were left unread.
export async function readTextCapped(res, maxBytes) {
	if (!res.body) return { text: '', truncated: false };
	const reader = res.body.getReader();
	const chunks = [];
	let total = 0;
	let truncated = false;
	try {
		while (total < maxBytes) {
			const { done, value } = await reader.read();
			if (done) break;
			const room = maxBytes - total;
			if (value.byteLength > room) {
				chunks.push(value.subarray(0, room));
				total += room;
				truncated = true;
				break;
			}
			chunks.push(value);
			total += value.byteLength;
		}
		if (total >= maxBytes && !truncated) {
			const { done } = await reader.read();
			truncated = !done;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}
