// Concurrent-connection budget for long-lived streams (SSE). A request-rate
// limiter cannot bound these: one request holds a socket, a timer and a poll
// loop for minutes. Counts live in process memory, which matches the resource
// being protected (this instance's sockets and timers).

/**
 * @param {{ perKey: number, total: number }} caps
 */
export function createStreamSlots({ perKey, total }) {
	const byKey = new Map();
	let open = 0;
	return {
		/** Returns a release function, or null when the key or the process is at its cap. */
		acquire(key) {
			const held = byKey.get(key) || 0;
			if (held >= perKey || open >= total) return null;
			byKey.set(key, held + 1);
			open += 1;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				open -= 1;
				const left = (byKey.get(key) || 1) - 1;
				if (left <= 0) byKey.delete(key);
				else byKey.set(key, left);
			};
		},
	};
}
