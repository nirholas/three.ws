/**
 * POST /api/social/upload
 *
 * Upload media (image/video) to R2/S3 and return a public URL
 * suitable for passing as media_urls in /api/social/post.
 *
 * Accepts multipart/form-data with a single `file` field.
 * Returns { ok, url, key, content_type, size_bytes }
 *
 * Max file size: 25 MB. Allowed types: image/* + video/mp4.
 */

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import { r2 } from '../_lib/r2.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_TYPES = new Set([
	'image/jpeg', 'image/png', 'image/gif', 'image/webp',
	'video/mp4', 'video/quicktime',
]);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const ct = (req.headers['content-type'] || '').toLowerCase();
	if (!ct.includes('multipart/form-data')) {
		return error(res, 415, 'unsupported_media_type', 'use multipart/form-data with a "file" field');
	}

	// Parse multipart manually using the boundary
	const boundary = ct.match(/boundary=([^\s;]+)/)?.[1];
	if (!boundary) return error(res, 400, 'invalid_multipart', 'missing boundary');

	let buf;
	try {
		buf = await readBody(req, MAX_BYTES);
	} catch (e) {
		return error(res, 413, 'file_too_large', `max upload size is ${MAX_BYTES / 1024 / 1024} MB`);
	}

	const { fileBuffer, filename, contentType } = parseMultipart(buf, boundary);
	if (!fileBuffer) return error(res, 400, 'no_file', 'no file field found in upload');

	const mimeBase = contentType?.split(';')[0]?.trim();
	if (!ALLOWED_TYPES.has(mimeBase)) {
		return error(res, 415, 'unsupported_file_type', `allowed types: ${[...ALLOWED_TYPES].join(', ')}`);
	}

	const ext = extFromMime(mimeBase);
	const key = `social/${randomBytes(12).toString('hex')}${ext}`;

	await r2.send(new PutObjectCommand({
		Bucket: env.S3_BUCKET,
		Key: key,
		Body: fileBuffer,
		ContentType: mimeBase,
		CacheControl: 'public, max-age=31536000, immutable',
	}));

	const publicUrl = `${env.S3_PUBLIC_DOMAIN}/${key}`;

	return json(res, 200, {
		ok: true,
		url: publicUrl,
		key,
		content_type: mimeBase,
		size_bytes: fileBuffer.length,
		filename: filename || null,
	});
});

function readBody(req, maxBytes) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		req.on('data', (chunk) => {
			total += chunk.length;
			if (total > maxBytes) return reject(new Error('too large'));
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

function parseMultipart(buf, boundary) {
	const boundaryBuf = Buffer.from(`--${boundary}`);
	const parts = splitBuffer(buf, boundaryBuf);

	for (const part of parts) {
		const headerEnd = indexOfSequence(part, Buffer.from('\r\n\r\n'));
		if (headerEnd === -1) continue;

		const headerStr = part.slice(0, headerEnd).toString('utf8');
		const bodyBuf = part.slice(headerEnd + 4);

		// Strip trailing \r\n before next boundary
		const body = bodyBuf.slice(0, bodyBuf.length - (bodyBuf.slice(-2).toString() === '\r\n' ? 2 : 0));

		const cdMatch = headerStr.match(/Content-Disposition:.*name="([^"]+)"/i);
		const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
		const fnMatch = headerStr.match(/filename="([^"]+)"/i);

		if (cdMatch?.[1] === 'file') {
			return {
				fileBuffer: body,
				filename: fnMatch?.[1] || null,
				contentType: ctMatch?.[1]?.trim() || 'application/octet-stream',
			};
		}
	}
	return { fileBuffer: null, filename: null, contentType: null };
}

function splitBuffer(buf, sep) {
	const parts = [];
	let start = 0;
	let idx;
	while ((idx = indexOfSequence(buf, sep, start)) !== -1) {
		parts.push(buf.slice(start, idx));
		start = idx + sep.length + 2; // skip \r\n after boundary
	}
	return parts;
}

function indexOfSequence(buf, seq, from = 0) {
	outer: for (let i = from; i <= buf.length - seq.length; i++) {
		for (let j = 0; j < seq.length; j++) {
			if (buf[i + j] !== seq[j]) continue outer;
		}
		return i;
	}
	return -1;
}

function extFromMime(mime) {
	const map = {
		'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
		'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov',
	};
	return map[mime] || '';
}
