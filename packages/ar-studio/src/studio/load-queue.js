// A priority-ordered, concurrency-capped async runner.
//
// Ten models tapped in quick succession must not open ten simultaneous GLB
// downloads on a phone: the network thrashes, the first model takes as long as
// the last, and the frame rate collapses while they all decode at once. This
// queue runs at most `maxActive` jobs, ordered by `priorityOf` (lower runs
// sooner), and lets a caller cancel work that is no longer wanted.
//
// Ported from the three.ws IRL loader (Apache-2.0).

// Generic priority queue with a concurrency cap. `run(item)` returns a promise;
// jobs start nearest-first via `priorityOf(item)` (lower number = sooner). The
// queue never rejects the caller's promise on cancellation silently: a
// cancelled job rejects with an Error('cancelled') the caller can ignore.
export function createLoadQueue({ run, maxActive = 5, priorityOf = () => 0 }) {
	const queue = [];   // [{ item, resolve, reject, cancelled }]
	let active = 0;
	const cfg = { run, maxActive, priorityOf };

	function pump() {
		// Re-sort on every pump so freshly-updated distances (the user moved) reorder
		// the pending loads before the next slot opens. O(n log n) over a small list.
		if (queue.length > 1) queue.sort((a, b) => cfg.priorityOf(a.item) - cfg.priorityOf(b.item));
		while (active < cfg.maxActive && queue.length) {
			const job = queue.shift();
			if (job.cancelled) continue;
			active++;
			Promise.resolve()
				.then(() => cfg.run(job.item))
				.then(job.resolve, job.reject)
				.finally(() => { active--; pump(); });
		}
	}

	return {
		// Enqueue `item`; resolves with `run(item)`'s result when a slot runs it.
		request(item) {
			return new Promise((resolve, reject) => {
				queue.push({ item, resolve, reject, cancelled: false });
				pump();
			});
		},
		// Drop still-queued jobs matching `pred` (already-running jobs finish).
		// Returns how many were cancelled.
		cancel(pred) {
			let n = 0;
			for (const job of queue) {
				if (!job.cancelled && pred(job.item)) {
					job.cancelled = true;
					job.reject(new Error('cancelled'));
					n++;
				}
			}
			return n;
		},
		// Live-tune the concurrency cap (the perf watchdog lowers it on low-end
		// devices) and immediately pump in case the cap rose.
		setMaxActive(n) { cfg.maxActive = Math.max(1, n | 0); pump(); },
		get active() { return active; },
		get pending() { return queue.reduce((c, j) => c + (j.cancelled ? 0 : 1), 0); },
	};
}
