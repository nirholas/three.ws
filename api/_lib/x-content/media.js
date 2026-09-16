// Native media rules for X posts and Articles.
//
// Native uploads are the whole point: a bare link card reads as automation and
// X ranks it below an image or clip that plays in the feed. Every attachment is
// a file that ships inside the Cloud Run image (public/ or data/), so the cron
// publishes exactly the bytes that were reviewed.
//
// Limits follow X's media upload documentation. Video is transcoded ahead of
// time by `npm run x:content -- prepare-video`, which records the probe this
// module validates, because the production image carries no ffmpeg.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const MB = 1024 * 1024;

export const MEDIA_ROOTS = ['public/', 'data/'];

export const MEDIA_TYPES = {
	'.jpg': { kind: 'image', mime: 'image/jpeg', maxBytes: 5 * MB },
	'.jpeg': { kind: 'image', mime: 'image/jpeg', maxBytes: 5 * MB },
	'.png': { kind: 'image', mime: 'image/png', maxBytes: 5 * MB },
	'.webp': { kind: 'image', mime: 'image/webp', maxBytes: 5 * MB },
	'.gif': { kind: 'gif', mime: 'image/gif', maxBytes: 15 * MB },
	'.mp4': { kind: 'video', mime: 'video/mp4', maxBytes: 512 * MB },
	'.mov': { kind: 'video', mime: 'video/quicktime', maxBytes: 512 * MB },
};

export const VIDEO_LIMITS = {
	minDurationSec: 0.5,
	maxDurationSec: 140,
	minSide: 32,
	maxWidth: 1920,
	maxHeight: 1200,
	maxFps: 60,
	minAspect: 1 / 3,
	maxAspect: 3,
};

export const MAX_ALT_TEXT = 1000;

export const CATEGORY = { image: 'tweet_image', gif: 'tweet_gif', video: 'tweet_video' };

export function mediaType(path) {
	return MEDIA_TYPES[extname(String(path || '')).toLowerCase()] || null;
}

// Problems with a single attachment. `root` is the repo (or image) root.
export function mediaProblems(media, root) {
	const problems = [];
	const path = String(media?.path || '');
	if (!path) return ['media entry has no path'];
	if (path.includes('..') || !MEDIA_ROOTS.some((prefix) => path.startsWith(prefix))) {
		problems.push(`${path}: media must live under ${MEDIA_ROOTS.join(' or ')} so it ships in the production image`);
	}
	const type = mediaType(path);
	if (!type) return [...problems, `${path}: unsupported format (use jpg, png, webp, gif, mp4, or mov)`];
	const absolute = resolve(root, path);
	if (!existsSync(absolute)) return [...problems, `${path}: file is missing`];

	const bytes = statSync(absolute).size;
	if (bytes > type.maxBytes) problems.push(`${path}: ${(bytes / MB).toFixed(1)} MB exceeds the ${type.maxBytes / MB} MB ${type.kind} limit`);

	if (type.kind !== 'video') {
		const alt = String(media.alt || '').trim();
		if (!alt) problems.push(`${path}: needs alt text`);
		if (alt.length > MAX_ALT_TEXT) problems.push(`${path}: alt text is ${alt.length} characters; X allows ${MAX_ALT_TEXT}`);
		return problems;
	}

	const probe = media.probe;
	if (!probe) {
		problems.push(`${path}: video has no probe; run \`npm run x:content -- prepare-video\` so its duration and encoding are checked`);
		return problems;
	}
	const L = VIDEO_LIMITS;
	if (!(probe.durationSec >= L.minDurationSec && probe.durationSec <= L.maxDurationSec)) {
		problems.push(`${path}: duration ${probe.durationSec}s is outside ${L.minDurationSec}-${L.maxDurationSec}s`);
	}
	if (probe.width < L.minSide || probe.height < L.minSide || probe.width > L.maxWidth || probe.height > L.maxHeight) {
		problems.push(`${path}: ${probe.width}x${probe.height} is outside ${L.minSide}px to ${L.maxWidth}x${L.maxHeight}`);
	}
	const aspect = probe.width / probe.height;
	if (!(aspect >= L.minAspect && aspect <= L.maxAspect)) problems.push(`${path}: aspect ratio ${aspect.toFixed(2)} is outside 1:3 to 3:1`);
	if (probe.fps > L.maxFps) problems.push(`${path}: ${probe.fps} fps exceeds ${L.maxFps}`);
	if (probe.videoCodec !== 'h264') problems.push(`${path}: video codec ${probe.videoCodec} must be h264`);
	if (probe.pixFmt && probe.pixFmt !== 'yuv420p') problems.push(`${path}: pixel format ${probe.pixFmt} must be yuv420p`);
	if (probe.audioCodec && probe.audioCodec !== 'aac') problems.push(`${path}: audio codec ${probe.audioCodec} must be aac`);
	return problems;
}

// Attachment-set rules for one post: up to four images, or exactly one GIF or
// one video.
export function attachmentProblems(mediaList) {
	const list = mediaList || [];
	const kinds = list.map((media) => mediaType(media.path)?.kind).filter(Boolean);
	const problems = [];
	if (list.length > 4) problems.push('a post carries at most four images');
	for (const kind of ['video', 'gif']) {
		if (kinds.includes(kind) && list.length !== 1) problems.push(`a ${kind} must be the only attachment on its post`);
	}
	return problems;
}

export function readMedia(media, root) {
	const type = mediaType(media.path);
	return { buffer: readFileSync(resolve(root, media.path)), mime: type.mime, kind: type.kind, category: CATEGORY[type.kind] };
}

// Reads the probe fields mediaProblems checks out of `ffmpeg -i <file>` stderr.
// The authoring CLI runs this right after encoding; production never does.
export function parseFfmpegProbe(stderr) {
	const duration = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
	const video = stderr.match(/Stream #\S+.*?: Video: (\w+)[^\n]*?, (\w+)(?:\([^)]*\))?, (\d+)x(\d+)[^\n]*?([\d.]+) fps/);
	const audio = stderr.match(/Stream #\S+.*?: Audio: (\w+)/);
	if (!duration || !video) return null;
	const probe = {
		durationSec: Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 100) / 100,
		width: Number(video[3]),
		height: Number(video[4]),
		fps: Number(video[5]),
		videoCodec: video[1],
		pixFmt: video[2],
	};
	if (audio) probe.audioCodec = audio[1];
	return probe;
}
