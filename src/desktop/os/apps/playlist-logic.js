// Pure helpers for the Media Player: queue order, shuffle, repeat, time
// formatting and the per-file resume position rules.

const AUDIO = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'weba', 'aac', 'opus'];
const VIDEO = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'];

const ext = (name) => {
	const i = String(name).lastIndexOf('.');
	return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};

/** 'audio' | 'video' | null, from a file name and an optional mime type. */
export function mediaKind(name, mime = '') {
	if (mime.startsWith('audio/')) return 'audio';
	if (mime.startsWith('video/')) return 'video';
	const e = ext(name);
	if (AUDIO.includes(e)) return 'audio';
	if (VIDEO.includes(e)) return 'video';
	return null;
}

export const titleFromName = (name) => String(name).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || String(name);

/** "3:07", "1:02:09"; "0:00" for anything not finite. */
export function formatTime(sec) {
	if (!Number.isFinite(sec) || sec < 0) return '0:00';
	const s = Math.floor(sec);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A play order over `n` items. Shuffle keeps `current` first so the playing track does not jump. */
export function buildOrder(n, { shuffle = false, current = 0, rng = Math.random } = {}) {
	const idx = Array.from({ length: n }, (_, i) => i);
	if (!shuffle || n < 2) return idx;
	const rest = idx.filter((i) => i !== current);
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[rest[i], rest[j]] = [rest[j], rest[i]];
	}
	return current >= 0 && current < n ? [current, ...rest] : rest;
}

/**
 * The item index to play after `current`, or null at the end of the queue.
 * repeat: 'off' | 'all' | 'one'. `auto` is true when the track ended by itself
 * (repeat 'one' only replays on auto-advance; the Next button still moves on).
 */
export function nextIndex(order, current, { repeat = 'off', auto = false } = {}) {
	if (!order.length) return null;
	if (auto && repeat === 'one') return current;
	const pos = order.indexOf(current);
	if (pos < 0) return order[0];
	if (pos + 1 < order.length) return order[pos + 1];
	return repeat === 'all' || repeat === 'one' ? order[0] : null;
}

export function prevIndex(order, current, { repeat = 'off' } = {}) {
	if (!order.length) return null;
	const pos = order.indexOf(current);
	if (pos < 0) return order[0];
	if (pos > 0) return order[pos - 1];
	return repeat === 'all' ? order[order.length - 1] : order[0];
}

/** Library entries (audio and video only) from file-system nodes, grouped Music then Videos, natural order. */
export function buildLibrary(nodes) {
	return nodes
		.filter((n) => n.type === 'file' && mediaKind(n.name, n.mime))
		.map((n) => ({ id: n.path, path: n.path, name: n.name, kind: mediaKind(n.name, n.mime), size: n.size }))
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.kind === 'audio' ? -1 : 1));
}

/** Should the position be remembered? Not for the first seconds or the last few, and not for unknown length. */
export function shouldRemember(pos, duration) {
	return Number.isFinite(duration) && duration > 20 && pos > 5 && pos < duration - 5;
}

/** Update a { path: seconds } map, bounded to `max` entries (oldest dropped). */
export function updateResume(map, key, pos, duration, max = 200) {
	const next = { ...map };
	delete next[key];
	if (shouldRemember(pos, duration)) next[key] = Math.floor(pos);
	const keys = Object.keys(next);
	for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete next[k];
	return next;
}
