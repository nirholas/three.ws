/**
 * Resumable R2 multipart upload for 360 capture files up to 8 GiB (contract C4,
 * prompts/finish/_context/insta360-00-CONTEXT.md). Used by api/capture-upload/*.
 *
 * Bytes go from the browser straight to R2 through presigned UploadPart URLs and
 * never touch Cloud Run. State lives in R2 itself, so there is no table and no
 * secret to sign: the object key embeds the owner (`captures/raw/<user>/<uuid>/
 * <file>`), an upload id only works with the key it was created for (R2 enforces
 * that), and the expected size rides in the multipart upload's own metadata.
 */

import { randomUUID } from 'node:crypto';
import {
	CreateMultipartUploadCommand,
	UploadPartCommand,
	CompleteMultipartUploadCommand,
	AbortMultipartUploadCommand,
	ListMultipartUploadsCommand,
	ListPartsCommand,
	HeadObjectCommand,
	DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';
import { r2, presignGet, listObjectsPage } from './r2.js';
import { cors, json, method, readJson, wrap } from './http.js';
import { requireCreator } from './creator-account.js';

export const MAX_CAPTURE_BYTES = 8 * 1024 ** 3;
export const MIN_PART_BYTES = 8 * 1024 ** 2;
export const MAX_PARTS = 1000;
export const MAX_SIGN_PARTS = 100;
export const SIGN_EXPIRES_S = 3600;
export const SOURCE_URL_EXPIRES_S = 7 * 24 * 3600;
export const MAX_OPEN_UPLOADS = 3;
export const DAILY_BYTE_QUOTA = 32 * 1024 ** 3;
export const RAW_PREFIX = 'captures/raw/';
const DAY_MS = 24 * 3600 * 1000;

const RAW_EXTENSIONS = ['.insv', '.insp', '.lrv'];
const TYPE_EXTENSIONS = Object.freeze({
	'video/mp4': ['.mp4', '.m4v'],
	'video/quicktime': ['.mov'],
	'image/jpeg': ['.jpg', '.jpeg'],
	'image/png': ['.png'],
	'image/x-exr': ['.exr'],
});

export class CaptureUploadError extends Error {
	constructor(status, error, message, extra = {}) {
		super(message);
		this.status = status;
		this.error = error;
		this.extra = extra;
	}
}

export function storageConfigured() {
	return Boolean(
		process.env.S3_ENDPOINT &&
			process.env.S3_BUCKET &&
			process.env.S3_ACCESS_KEY_ID &&
			process.env.S3_SECRET_ACCESS_KEY,
	);
}

/** Smallest part size (8 MiB floor, rounded up to a MiB) that keeps part_count <= 1000. */
export function planParts(sizeBytes) {
	const MIB = 1024 ** 2;
	const needed = Math.ceil(sizeBytes / MAX_PARTS / MIB) * MIB;
	const partSize = Math.max(MIN_PART_BYTES, needed);
	return { part_size: partSize, part_count: Math.max(1, Math.ceil(sizeBytes / partSize)) };
}

/** Path-free, ASCII-safe filename that keeps its extension. */
export function sanitiseFilename(name) {
	const base = String(name).split(/[\\/]/).pop().normalize('NFKD');
	const cleaned = base
		.replace(/[^A-Za-z0-9._-]+/g, '_')
		.replace(/^[._]+/, '')
		.replace(/_{2,}/g, '_');
	if (cleaned.length <= 120) return cleaned;
	const dot = cleaned.lastIndexOf('.');
	const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
	return cleaned.slice(0, 120 - ext.length) + ext;
}

/** Validate a create request body. Returns `{ filename, content_type, size_bytes }` or throws. */
export function validateCreate(body) {
	const rawName = typeof body?.filename === 'string' ? body.filename.trim() : '';
	if (!rawName || rawName.length > 255) {
		throw new CaptureUploadError(400, 'invalid_filename', 'Send the capture file name (up to 255 characters).');
	}
	const filename = sanitiseFilename(rawName);
	const dot = filename.lastIndexOf('.');
	const ext = dot > 0 ? filename.slice(dot).toLowerCase() : '';
	if (!ext) {
		throw new CaptureUploadError(400, 'invalid_filename', 'The file name needs an extension such as .mp4, .insv or .jpg.');
	}
	if (body?.kind !== 'pano') {
		throw new CaptureUploadError(400, 'invalid_kind', 'kind must be "pano".');
	}
	const contentType = typeof body?.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
	if (contentType === 'application/octet-stream') {
		if (!RAW_EXTENSIONS.includes(ext)) {
			throw new CaptureUploadError(400, 'invalid_content_type', 'Generic binary uploads are only accepted for raw camera files ending in .insv, .insp or .lrv.');
		}
	} else if (Object.hasOwn(TYPE_EXTENSIONS, contentType)) {
		if (!TYPE_EXTENSIONS[contentType].includes(ext)) {
			throw new CaptureUploadError(400, 'invalid_filename', `A ${contentType} upload needs a file name ending in ${TYPE_EXTENSIONS[contentType].join(' or ')}.`);
		}
	} else {
		throw new CaptureUploadError(400, 'invalid_content_type', 'content_type must be video/mp4, video/quicktime, image/jpeg, image/png, image/x-exr, or application/octet-stream for .insv, .insp and .lrv files.');
	}
	const size = body?.size_bytes;
	if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_CAPTURE_BYTES) {
		throw new CaptureUploadError(400, 'invalid_size', 'size_bytes must be a whole number between 1 byte and 8 GiB.');
	}
	return { filename, content_type: contentType, size_bytes: size };
}

export function userSegment(userId) {
	return String(userId).replace(/[^A-Za-z0-9_-]/g, '_');
}

export function userPrefix(userId) {
	return `${RAW_PREFIX}${userSegment(userId)}/`;
}

/** Throws 403 unless `key` is a capture object belonging to `userId`. */
export function assertOwnsKey(userId, key) {
	const ok =
		typeof key === 'string' &&
		key.startsWith(userPrefix(userId)) &&
		!key.includes('..') &&
		/^captures\/raw\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(key);
	if (!ok) {
		throw new CaptureUploadError(403, 'forbidden', 'That upload does not belong to your account.');
	}
}

function assertUploadId(uploadId) {
	if (typeof uploadId !== 'string' || !uploadId || uploadId.length > 2048) {
		throw new CaptureUploadError(400, 'invalid_upload_id', 'upload_id is missing or malformed.');
	}
}

async function openUploads(userId) {
	const out = await r2.send(
		new ListMultipartUploadsCommand({ Bucket: env.S3_BUCKET, Prefix: userPrefix(userId) }),
	);
	const cutoff = Date.now() - DAY_MS;
	return (out.Uploads || []).filter((u) => !u.Initiated || new Date(u.Initiated).getTime() > cutoff);
}

async function bytesCompletedToday(userId) {
	const cutoff = Date.now() - DAY_MS;
	let total = 0;
	let token;
	do {
		const page = await listObjectsPage({ prefix: userPrefix(userId), continuationToken: token });
		for (const o of page.objects) {
			if (o.lastModified && new Date(o.lastModified).getTime() > cutoff) total += o.size;
		}
		token = page.nextToken;
	} while (token);
	return total;
}

/** Start a multipart upload after checking the per-user open-upload and daily-byte limits. */
export async function createUpload(userId, body) {
	const v = validateCreate(body);
	const open = await openUploads(userId);
	if (open.length >= MAX_OPEN_UPLOADS) {
		throw new CaptureUploadError(
			429,
			'too_many_open_uploads',
			`You already have ${MAX_OPEN_UPLOADS} uploads in progress. Finish or cancel one before starting another.`,
		);
	}
	const used = await bytesCompletedToday(userId);
	if (used + v.size_bytes > DAILY_BYTE_QUOTA) {
		throw new CaptureUploadError(
			429,
			'daily_quota_exceeded',
			'You have reached the daily capture upload limit of 32 GiB. Try again tomorrow.',
		);
	}
	const key = `${userPrefix(userId)}${randomUUID()}/${v.filename}`;
	const out = await r2.send(
		new CreateMultipartUploadCommand({
			Bucket: env.S3_BUCKET,
			Key: key,
			ContentType: v.content_type,
			Metadata: { size_bytes: String(v.size_bytes) },
		}),
	);
	if (!out.UploadId) {
		throw new CaptureUploadError(502, 'create_failed', 'Storage did not start the upload. Try again.');
	}
	return { upload_id: out.UploadId, key, ...planParts(v.size_bytes) };
}

/** Presigned UploadPart URLs for the requested part numbers. */
export async function signParts(userId, body) {
	assertUploadId(body?.upload_id);
	assertOwnsKey(userId, body?.key);
	const nums = body?.part_numbers;
	if (
		!Array.isArray(nums) ||
		nums.length === 0 ||
		nums.length > MAX_SIGN_PARTS ||
		!nums.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_PARTS)
	) {
		throw new CaptureUploadError(400, 'invalid_part_numbers', `part_numbers must list 1 to ${MAX_SIGN_PARTS} whole numbers between 1 and ${MAX_PARTS}.`);
	}
	const urls = {};
	for (const n of new Set(nums)) {
		urls[String(n)] = await getSignedUrl(
			r2,
			new UploadPartCommand({ Bucket: env.S3_BUCKET, Key: body.key, UploadId: body.upload_id, PartNumber: n }),
			{ expiresIn: SIGN_EXPIRES_S },
		);
	}
	return { urls };
}

/** Finish the upload, verify the stored size, and return a worker-fetchable URL. */
export async function completeUpload(userId, body) {
	assertUploadId(body?.upload_id);
	assertOwnsKey(userId, body?.key);
	const parts = body?.parts;
	if (
		!Array.isArray(parts) ||
		parts.length === 0 ||
		parts.length > MAX_PARTS ||
		!parts.every((p) => Number.isInteger(p?.part_number) && p.part_number >= 1 && p.part_number <= MAX_PARTS && typeof p?.etag === 'string' && p.etag)
	) {
		throw new CaptureUploadError(400, 'invalid_parts', 'parts must list every uploaded part as { part_number, etag }.');
	}
	const ordered = [...parts]
		.sort((a, b) => a.part_number - b.part_number)
		.map((p) => ({ PartNumber: p.part_number, ETag: p.etag }));
	try {
		await r2.send(
			new CompleteMultipartUploadCommand({
				Bucket: env.S3_BUCKET,
				Key: body.key,
				UploadId: body.upload_id,
				MultipartUpload: { Parts: ordered },
			}),
		);
	} catch (err) {
		const code = err?.Code || err?.name;
		if (code === 'NoSuchUpload') {
			throw new CaptureUploadError(404, 'upload_not_found', 'This upload expired or was already finished. Start the upload again.');
		}
		if (code === 'InvalidPart' || code === 'InvalidPartOrder' || code === 'EntityTooSmall') {
			throw new CaptureUploadError(400, 'invalid_parts', 'Storage rejected the part list. Re-upload the missing parts and try again.');
		}
		throw err;
	}
	const head = await r2.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: body.key }));
	const expected = Number(head.Metadata?.size_bytes);
	const actual = Number(head.ContentLength);
	if (!Number.isFinite(expected) || expected !== actual) {
		await r2.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: body.key })).catch(() => {});
		throw new CaptureUploadError(
			422,
			'size_mismatch',
			'The uploaded file is not the size you declared, so it was discarded. Upload it again.',
			{ expected_bytes: expected, actual_bytes: actual },
		);
	}
	const source_url = await presignGet({ key: body.key, expiresIn: SOURCE_URL_EXPIRES_S });
	return { source_url, size_bytes: actual };
}

/** Parts already stored for an upload (resume support). Extension of C4. */
export async function listUploadedParts(userId, body) {
	assertUploadId(body?.upload_id);
	assertOwnsKey(userId, body?.key);
	const parts = [];
	let marker;
	try {
		do {
			const out = await r2.send(
				new ListPartsCommand({ Bucket: env.S3_BUCKET, Key: body.key, UploadId: body.upload_id, PartNumberMarker: marker, MaxParts: 1000 }),
			);
			for (const p of out.Parts || []) parts.push({ part_number: p.PartNumber, etag: p.ETag, size: p.Size });
			marker = out.IsTruncated ? out.NextPartNumberMarker : undefined;
		} while (marker);
	} catch (err) {
		if ((err?.Code || err?.name) === 'NoSuchUpload') {
			throw new CaptureUploadError(404, 'upload_not_found', 'This upload expired or was already finished. Start the upload again.');
		}
		throw err;
	}
	return { parts };
}

export async function abortUpload(userId, body) {
	assertUploadId(body?.upload_id);
	assertOwnsKey(userId, body?.key);
	try {
		await r2.send(new AbortMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: body.key, UploadId: body.upload_id }));
	} catch (err) {
		if ((err?.Code || err?.name) !== 'NoSuchUpload') throw err;
	}
	return { ok: true };
}

/** Shared endpoint shell: CORS, POST only, storage check, account, JSON body, error mapping. */
export function captureUploadHandler(action, work) {
	return wrap(async (req, res) => {
		if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
		if (!method(req, res, ['POST'])) return;
		if (!storageConfigured()) {
			return json(res, 503, {
				error: 'unconfigured',
				message: 'Large capture uploads are not available right now. Try again later.',
				hint: 'Object storage env (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) is unset on this deployment.',
			});
		}
		const who = await requireCreator(req, res, { action, allowPlatform: false });
		if (!who) return;
		const body = await readJson(req, 256_000).catch(() => null);
		if (!body || typeof body !== 'object') {
			return json(res, 400, { error: 'invalid_json', message: 'Send a JSON body.' });
		}
		try {
			return json(res, 200, await work(who.user.id, body));
		} catch (err) {
			if (err instanceof CaptureUploadError) {
				return json(res, err.status, { error: err.error, message: err.message, ...err.extra });
			}
			console.error(`[capture-upload] ${action} failed:`, err?.message || err);
			return json(res, 502, {
				error: 'storage_error',
				message: 'Storage could not complete that step. Try again in a moment.',
			});
		}
	});
}
