// Which Forge editing tools the server can run right now, read once per page.
//
// GET /api/forge?catalog carries a `tools` map ({ [id]: { label, available } },
// built by api/_lib/forge-tool-availability.js) whose `available` flag is the
// same gate the tool's own endpoint applies before it dispatches to a worker.
// A page uses it to hide or disable a tool whose worker is not deployed, so the
// visitor never does the work (paints a region, picks a part) only to be told
// afterwards that the tool cannot run.
//
// Fail-open by design: when the catalog cannot be read (offline, an old server
// without the map), every tool stays offered and the endpoint's own answer is
// still the truth the visitor sees. A failed read is not cached, so the next
// caller tries again.

const CATALOG_URL = '/api/forge?catalog=1';

let pending = null;

export function loadForgeTools({ fetchImpl = globalThis.fetch } = {}) {
	if (pending) return pending;
	pending = (async () => {
		try {
			const res = await fetchImpl(CATALOG_URL);
			if (!res?.ok) return null;
			const body = await res.json();
			return body && body.tools && typeof body.tools === 'object' ? body.tools : null;
		} catch {
			return null;
		}
	})().then((tools) => {
		if (!tools) pending = null;
		return tools;
	});
	return pending;
}

// True only when the server positively said the tool cannot run. Unknown (no
// map, or a tool id the server does not list) is never treated as unavailable.
export function toolUnavailable(tools, id) {
	return Boolean(tools && tools[id] && tools[id].available === false);
}

// Test seam: forget the memoized read.
export function resetForgeToolsForTests() {
	pending = null;
}
