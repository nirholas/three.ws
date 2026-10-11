// In-process fan-out of coordinator events, keyed by run id.
//
// Every event is persisted first (store.appendEvent) and then published here,
// so an SSE response open on this instance sees it live. A decision taken on
// another instance (the approval inbox, a push action, Telegram) still reaches
// the chat: the page's stream endpoint tails the persisted events by id.

const listeners = new Map();

export function subscribe(runId, fn) {
	if (!listeners.has(runId)) listeners.set(runId, new Set());
	listeners.get(runId).add(fn);
	return () => {
		const set = listeners.get(runId);
		if (!set) return;
		set.delete(fn);
		if (!set.size) listeners.delete(runId);
	};
}

export function publish(runId, event) {
	const set = listeners.get(runId);
	if (!set) return;
	for (const fn of set) {
		try {
			fn(event);
		} catch (e) {
			console.warn('[team-chat] listener failed', e?.message);
		}
	}
}
