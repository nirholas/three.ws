'use strict';

const { ApiError, MESSAGES } = require('./errors');

const VIDEO_EXT = ['.mp4', '.m4v', '.mov'];
const IMAGE_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

function extensionOf(name) {
	const base = String(name || '').split(/[\\/]/).pop();
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function baseName(path) {
	return String(path || '').split(/[\\/]/).pop();
}

/** A video whose frame is 2:1 (within 2%) is an equirectangular 360 video. */
function isTwoToOne(width, height) {
	if (!(width > 0) || !(height > 0)) return false;
	return Math.abs(width / height - 2) <= 0.04;
}

/**
 * Decide which three.ws lane a local file belongs to.
 *
 * lane "capture": POST /api/pano-capture (360 video to Gaussian splat)
 * lane "scene":   POST /api/pano-scene   (one 360 photo to a depth shell GLB)
 *
 * `is360` is true when the file proves it (raw Insta360 extension, VR tag read through the
 * Premiere API, or a 2:1 frame) and null when only the user can say (an .mp4 with no readable
 * metadata). The panel asks for a one-tick confirmation in that case.
 */
function classifyFile({ name, width, height, vrTagged } = {}) {
	const ext = extensionOf(name);
	if (ext === '.insv') {
		return { lane: 'capture', source_kind: 'insv', contentType: 'application/octet-stream', is360: true, reason: 'raw 360 camera video' };
	}
	if (ext === '.insp') {
		return { lane: 'scene', source_kind: 'insp', contentType: 'application/octet-stream', is360: true, reason: 'raw 360 camera photo' };
	}
	if (ext === '.lrv') {
		return { lane: null, error: new ApiError('invalid_filename', 'A .lrv file is the camera\'s low-resolution preview. Send the matching .insv file instead.') };
	}
	if (VIDEO_EXT.includes(ext)) {
		const proven = Boolean(vrTagged) || isTwoToOne(width, height);
		let reason = 'confirm that this is a stitched 360 video';
		if (vrTagged) reason = 'tagged as VR footage in Premiere Pro';
		else if (isTwoToOne(width, height)) reason = 'frame is 2:1';
		else if (width > 0 && height > 0) reason = 'frame is not 2:1, so it may not be 360';
		return {
			lane: 'capture',
			source_kind: 'equirect_video',
			contentType: ext === '.mov' ? 'video/quicktime' : 'video/mp4',
			is360: proven ? true : width > 0 && height > 0 ? false : null,
			reason,
		};
	}
	if (Object.hasOwn(IMAGE_EXT, ext)) {
		const proven = isTwoToOne(width, height);
		return {
			lane: 'scene',
			source_kind: 'equirect_image',
			contentType: IMAGE_EXT[ext],
			is360: proven ? true : width > 0 && height > 0 ? false : null,
			reason: proven ? 'frame is 2:1' : 'confirm that this is a 360 photo',
		};
	}
	return { lane: null, error: new ApiError('invalid_content_type', MESSAGES.invalid_content_type) };
}

/**
 * Insta360 X-series cameras write each shot as two lens files that share a stem:
 * VID_20240101_120000_00_001.insv (front) and VID_20240101_120000_10_001.insv (back).
 * Given one name and the folder listing, return both in lens order, or just the one.
 */
function findSplitPair(name, siblings) {
	const m = /^(.*_)(00|10)(_\d+\.insv)$/i.exec(name);
	if (!m) return [name];
	const other = m[2] === '00' ? '10' : '00';
	const partner = `${m[1]}${other}${m[3]}`;
	const found = (siblings || []).find((s) => s.toLowerCase() === partner.toLowerCase());
	if (!found) return [name];
	return m[2] === '00' ? [name, found] : [found, name];
}

/**
 * Trim from Premiere in/out points (seconds into the source). Returns null when the points cover the whole
 * clip or are not a usable range, so the worker processes the full footage.
 */
function buildTrim(inSeconds, outSeconds, durationSeconds) {
	const start = Number(inSeconds);
	const end = Number(outSeconds);
	const duration = Number(durationSeconds);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1) return null;
	const s = Math.max(0, start);
	const wholeClip = Number.isFinite(duration) && duration > 0 && s < 0.05 && end >= duration - 0.05;
	if (wholeClip) return null;
	return { start_s: Math.round(s * 1000) / 1000, end_s: Math.round(end * 1000) / 1000 };
}

const QUALITIES = Object.freeze([
	{ id: 'preview', label: 'Preview (fastest)' },
	{ id: 'standard', label: 'Standard' },
	{ id: 'high', label: 'High (slowest)' },
]);

/** Body for POST /api/pano-capture. */
function buildCaptureBody({ sourceUrls, sourceKind, trim, quality }) {
	const body = { source_url: sourceUrls[0], source_kind: sourceKind, quality: quality || 'standard' };
	if (sourceUrls.length > 1) body.source_urls = sourceUrls;
	if (trim) body.trim = trim;
	return body;
}

module.exports = { extensionOf, baseName, isTwoToOne, classifyFile, findSplitPair, buildTrim, buildCaptureBody, QUALITIES };
