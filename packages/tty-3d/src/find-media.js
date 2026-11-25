// Newest photo or video in a directory. The CLI uses this when you point it at
// a folder, or pass --find, instead of scanning the rest of the machine.

import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);

export function mediaKind(file) {
	const ext = extname(String(file || '')).toLowerCase();
	if (IMAGE_EXT.has(ext)) return 'image';
	if (VIDEO_EXT.has(ext)) return 'video';
	return null;
}

export function contentTypeFor(file) {
	const ext = extname(String(file || '')).toLowerCase();
	if (ext === '.png') return 'image/png';
	if (ext === '.webp') return 'image/webp';
	return 'image/jpeg';
}

/** Newest matching file in `dir`, or null. `kind` is image, video, or any. */
export function findNewestMedia(dir, kind = 'image') {
	const allow = kind === 'video' ? VIDEO_EXT : kind === 'any' ? new Set([...IMAGE_EXT, ...VIDEO_EXT]) : IMAGE_EXT;
	let best = null;
	let bestMtime = -1;
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		return null;
	}
	for (const name of names) {
		if (name.startsWith('.')) continue;
		if (!allow.has(extname(name).toLowerCase())) continue;
		const full = join(dir, name);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (!st.isFile()) continue;
		if (st.mtimeMs >= bestMtime) {
			bestMtime = st.mtimeMs;
			best = full;
		}
	}
	return best;
}
