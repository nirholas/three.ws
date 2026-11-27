// Boundary check for every address a stranger can hand to Forge that a worker
// will later fetch (image_urls, image_url, glb_url).
//
// Before this module, image mode accepted anything that matched /^https?:\/\//,
// so `http://169.254.169.254/...` or `http://127.0.0.1:8080/...` was forwarded to
// the worker, which then fetched it from inside our network. The same address
// guard the mesh endpoints use (api/_lib/ssrf-guard.js) now runs here, once, so
// all of Forge shares one policy and one set of tests
// (tests/api/forge-input-security.test.js).
//
// A name that resolves nowhere (NXDOMAIN, no records) is let through: it points
// at nothing, so there is no internal service for a worker to reach, and the
// worker reports its own fetch failure. Any other lookup failure (timeout,
// SERVFAIL) and every name that resolves to a private, loopback, link-local or
// metadata address is refused.

import { assertSafePublicUrl, SsrfBlockedError } from './ssrf-guard.js';
import { getObjectRange, headObject, isStorageInfrastructureError, keyFromPublicUrl } from './r2.js';
import { ANON_UPLOAD_LIMITS } from './anon-upload-limits.js';
import { HEADER_BYTES, PASS_MAX_SIDE, readImageInfo, sniffImage, UPLOAD_MIME } from '../../src/shared/forge-image-intake.js';

const NOTHING_THERE = new Set(['ENOTFOUND', 'ENODATA']);

// Returns the first address the worker must not be given, or null when every
// address is safe. `allowHttp` defaults to true: Forge has always accepted
// http:// reference images, so refusing them is a separate, visible change.
export async function findUnsafeUrl(urls, { allowHttp = true } = {}) {
	const verdicts = await Promise.all(
		urls.map(async (value) => {
			try {
				await assertSafePublicUrl(value, { allowHttp });
				return null;
			} catch (err) {
				if (!(err instanceof SsrfBlockedError)) throw err;
				if (err.dnsCode && NOTHING_THERE.has(err.dnsCode)) return null;
				return { url: value, reason: err.message };
			}
		}),
	);
	return verdicts.find(Boolean) || null;
}

const UPLOAD_PREFIX = 'forge/uploads/';

// A reference photo the person uploaded lands in forge/uploads/ by a presigned
// PUT. That PUT cannot pin the file's size or type (api/forge-upload.js explains
// why), and the sweeper deletes an overage an hour later, so the bucket will hold
// whatever the browser sent. This reads the stored bytes when a job is submitted:
// the type comes from the leading bytes, the size from the object, the canvas
// from the header. Addresses outside the upload prefix are not ours to read and
// are left to the worker's own fetch rules.
//
// Fail-open on storage: if the bucket is down or the object is not there yet the
// job still goes, the worker re-validates what it downloads, and an outage must
// not block a paying person (CLAUDE.md). Only a definite bad verdict refuses.
//
// Returns the first refusal as { url, status, code, message } or null.
export async function verifyUploadedReferences(urls) {
	const verdicts = await Promise.all(urls.map(verifyOne));
	return verdicts.find(Boolean) || null;
}

async function verifyOne(url) {
	let key;
	try {
		key = keyFromPublicUrl(url);
	} catch {
		return null; // a deployment with no public bucket domain has no uploads to read
	}
	if (!key || !key.startsWith(UPLOAD_PREFIX)) return null;
	let head;
	let bytes;
	try {
		head = await headObject(key);
		if (!head) return null;
		if ((head.ContentLength ?? 0) > ANON_UPLOAD_LIMITS[UPLOAD_PREFIX]) {
			return {
				url,
				status: 413,
				code: 'image_too_large',
				message: `That photo is larger than the ${ANON_UPLOAD_LIMITS[UPLOAD_PREFIX] / (1024 * 1024)} MB limit. Upload a smaller copy.`,
			};
		}
		bytes = await getObjectRange(key, HEADER_BYTES);
	} catch (err) {
		if (!isStorageInfrastructureError(err)) console.warn(`[forge] could not verify uploaded reference ${key}: ${err?.message || err}`);
		return null;
	}
	const { format } = sniffImage(bytes);
	if (!format || !UPLOAD_MIME[format]) {
		return {
			url,
			status: 415,
			code: 'invalid_image_type',
			message: 'That file is not a PNG, JPEG or WebP image. Upload a photo saved in one of those formats.',
		};
	}
	const { width, height } = readImageInfo(bytes, format);
	if (width > PASS_MAX_SIDE || height > PASS_MAX_SIDE) {
		return {
			url,
			status: 422,
			code: 'invalid_image_dimensions',
			message: `That photo is ${width} x ${height} pixels. Forge reads images up to ${PASS_MAX_SIDE} pixels on a side; shrink it and try again.`,
		};
	}
	return null;
}
