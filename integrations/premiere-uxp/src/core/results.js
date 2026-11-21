'use strict';

const { ApiError, MESSAGES, normalise } = require('./errors');
const { withRetry } = require('./retry');

const BIN_NAME = 'three.ws captures';

/** Files brought back for each lane, in import order. `field` is the key in the job's `result`. */
const CAPTURE_FILES = Object.freeze([
	{ field: 'preview_url', file: 'preview.mp4' },
	{ field: 'poster_url', file: 'poster.jpg' },
	{ field: 'ply_url', file: 'scene.ply' },
	{ field: 'spz_url', file: 'scene.spz' },
]);
const SCENE_FILES = Object.freeze([
	{ field: 'glb_url', file: 'scene.glb' },
	{ field: 'ply_url', file: 'scene.ply' },
]);

function splitPath(path) {
	const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
	const parts = path.split(/[\\/]/);
	return { sep, parts };
}

function stem(fileName) {
	const dot = fileName.lastIndexOf('.');
	return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * `<project dir>/<project name>_three.ws/<job id>/`, or null when the project has never been saved.
 * Returns the folder as segments relative to the project directory so the host layer can create each level.
 */
function resultFolder(projectPath, jobId) {
	if (!projectPath || !jobId) return null;
	const { sep, parts } = splitPath(projectPath);
	const fileName = parts.pop();
	if (!fileName || !parts.length) return null;
	const cleaned = String(jobId).replace(/[^A-Za-z0-9_-]/g, '_');
	// pano-scene job ids are signed tokens; their tail (the signature) is the unique part.
	const safeJob = cleaned.length > 48 ? cleaned.slice(-40) : cleaned;
	const root = `${stem(fileName)}_three.ws`;
	return { dir: parts.join(sep), levels: [root, safeJob], full: [...parts, root, safeJob].join(sep), sep };
}

function filesFor(lane, result) {
	const table = lane === 'scene' ? SCENE_FILES : CAPTURE_FILES;
	return table.filter((f) => typeof result?.[f.field] === 'string' && result[f.field]).map((f) => ({ ...f, url: result[f.field] }));
}

/**
 * Download every result file of a finished job into the result folder.
 * `save(url, fileName, onBytes) -> nativePath` streams one file to disk (see stream.js).
 * Returns { paths, missing } where `missing` lists files the job did not produce.
 */
async function fetchResults({ lane, result, save, token, sleep, onFile = () => {} }) {
	const files = filesFor(lane, result);
	if (!files.length) throw new ApiError('unexpected_response', MESSAGES.unexpected_response);
	const paths = [];
	for (let i = 0; i < files.length; i++) {
		token.throwIfCancelled();
		const f = files[i];
		onFile({ index: i, total: files.length, file: f.file, bytes: 0, totalBytes: 0 });
		const onBytes = (bytes, totalBytes) => onFile({ index: i, total: files.length, file: f.file, bytes, totalBytes });
		const path = await withRetry(
			async () => {
				try {
					return await save(f.url, f.file, onBytes);
				} catch (raw) {
					const err = normalise(raw);
					if (err.code === 'cancelled') throw err;
					if (err.code === 'download_failed') throw err;
					throw new ApiError('download_failed', MESSAGES.download_failed, { status: err.status, retryable: err.retryable !== false });
				}
			},
			{ attempts: 4, baseMs: 750, sleep, token },
		);
		paths.push(path);
	}
	const produced = new Set(files.map((f) => f.file));
	const missing = (lane === 'scene' ? SCENE_FILES : CAPTURE_FILES).filter((f) => !produced.has(f.file)).map((f) => f.file);
	return { paths, missing };
}

/** The viewer link a job offers. Prefers the API's `viewer_url`, else derives /splat?src=<spz>. */
function viewerLink(origin, result) {
	if (result && typeof result.viewer_url === 'string' && result.viewer_url) {
		return /^https?:\/\//i.test(result.viewer_url) ? result.viewer_url : `${origin}${result.viewer_url}`;
	}
	if (result && typeof result.spz_url === 'string' && result.spz_url) return `${origin}/splat?src=${encodeURIComponent(result.spz_url)}`;
	return '';
}

module.exports = { BIN_NAME, CAPTURE_FILES, SCENE_FILES, resultFolder, filesFor, fetchResults, viewerLink };
