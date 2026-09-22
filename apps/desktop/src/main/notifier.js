// Polls the account inbox and hands genuinely new notifications to the OS.
//
// The platform has no notification stream, so this polls /api/notifications on
// a relaxed interval (faster while the console is focused, slower in the
// tray). The first poll after sign-in only records what is already there:
// launching the app must not replay a backlog as a burst of OS toasts.

export function createNotifier({ api, onNew, onUnread = () => {}, focusedMs = 20_000, idleMs = 60_000, setTimer = setTimeout, clearTimer = clearTimeout }) {
	const seen = new Set();
	let primed = false;
	let timer = null;
	let running = false;
	let focused = false;
	let lastUnread = null;

	async function poll() {
		const { items, unread } = await api.notifications();
		if (unread !== lastUnread) {
			lastUnread = unread;
			onUnread(unread);
		}
		const fresh = [];
		for (const n of items) {
			if (seen.has(n.id)) continue;
			seen.add(n.id);
			if (primed && !n.read) fresh.push(n);
		}
		primed = true;
		// Oldest first, so the OS stacks them in the order they happened.
		for (const n of fresh.reverse()) onNew(n);
		return fresh.length;
	}

	function schedule() {
		clearTimer(timer);
		if (!running) return;
		timer = setTimer(tick, focused ? focusedMs : idleMs);
	}

	async function tick() {
		try {
			await poll();
		} catch (err) {
			if (err?.code === 'signed_out') {
				stop();
				return;
			}
			// Offline or a 5xx: try again on the next interval.
		}
		schedule();
	}

	function start() {
		if (running) return;
		running = true;
		tick();
	}

	function stop() {
		running = false;
		clearTimer(timer);
		timer = null;
		seen.clear();
		primed = false;
		lastUnread = null;
	}

	function setFocused(value) {
		const next = Boolean(value);
		if (next === focused) return;
		focused = next;
		if (running && focused) tick();
		else schedule();
	}

	return { start, stop, poll, setFocused, get running() { return running; } };
}
