// JSON fetch for the Arena page. Sends the session cookie, throws on a failed
// status with the API's error description, and returns the parsed body.
//
// A success whose body is not JSON (a captive portal's HTML page, an empty 200
// from a proxy) throws too. It used to come back as null, and the marquee read
// `data.standings` off it.
export async function fetchJSON(url, opts) {
	const res = await fetch(url, { credentials: 'include', ...opts });
	let body = null;
	let parsed = false;
	try {
		body = await res.json();
		parsed = true;
	} catch {
		/* non-JSON */
	}
	if (!res.ok) {
		const err = new Error(body?.error_description || body?.error || `HTTP ${res.status}`);
		err.status = res.status;
		err.code = body?.error;
		throw err;
	}
	if (!parsed || body === null || typeof body !== 'object') {
		const err = new Error('The server sent an unreadable response. Reload the page to try again.');
		err.status = res.status;
		throw err;
	}
	return body;
}
