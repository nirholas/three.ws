// Shared image persistence for generated images.
//
// Two call sites grew byte-identical copies of this (api/_mcp3d/text-to-image.js
// for the NIM FLUX artifact, api/_lib/forge-reference-image.js for the Vertex
// Gemini inline data) and the Livepeer federation provider needed a third. The
// rule it enforces matters enough to live in exactly one place:
//
//   Downstream image-to-3D providers take URLs, not inline data (Replicate caps
//   inline data URIs at ~256 KB - a 1024px image blows straight past that), so
//   every synthesized image is persisted to R2 and handed on as a durable
//   public https URL.
//
// The one exception is a storage outage: see persistImageBytes below, which
// falls back to an inline data URI our own workers can read rather than letting
// a rejected bucket credential fail the whole generation. Use isInlineImageRef()
// before handing a reference view to a third-party provider.
//
// The format is sniffed from the magic bytes so the object key extension and
// Content-Type always match the real payload: NIM FLUX returns JPEG artifacts,
// Vertex Imagen and Gemini return PNG, and the Livepeer gateway can serve
// either. Unknown bytes keep the PNG label (the historical default).

import { putObject, publicUrl, isStorageInfrastructureError } from './r2.js';

// 'jpg' | 'png' - sniffed from magic bytes. JPEG: FF D8 FF. Anything else is
// labeled png, matching the legacy behavior of every prior copy of this code.
export function sniffImageFormat(body) {
	const isJpeg = body.length > 2 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
	return isJpeg ? 'jpg' : 'png';
}

// True when the bytes start with a known image signature (JPEG or PNG). The
// federation adapter uses this as the cheap verification gate before paying
// the persistence write: a gateway that answers 200 with an HTML error page or
// an empty body fails here instead of poisoning the reference-image pipeline.
export function looksLikeImageBytes(body) {
	if (!body || body.length < 4) return false;
	if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return true; // JPEG
	return body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47; // PNG
}

// Largest payload we will inline as a data URI when object storage is down.
// A synthesized reference view is 0.2-1.5 MB; base64 inflates it by 4/3, so 4 MB
// of source bytes stays a sane JSON request body for our own workers while
// refusing to turn a pathological payload into a multi-megabyte POST.
const INLINE_FALLBACK_MAX_BYTES = 4 * 1024 * 1024;

// True for a reference view we synthesized inline rather than parked in the
// bucket. Callers that hand the view to a THIRD-PARTY reconstructor must refuse
// it (those APIs take a URL they can fetch); our own workers accept it, because
// every one of them declares `images: [data-uri|url, ...]` and decodes the
// base64 directly (workers/model-{trellis,hunyuan3d,triposg}/main.py).
export function isInlineImageRef(url) {
	return typeof url === 'string' && url.startsWith('data:image/');
}

// Persist raw image bytes and return a reference the reconstruction lane can
// read: a durable public https URL normally, and an inline data URI when the
// bucket refuses the write.
//
// The fallback exists because this one write is a single point of failure for
// the whole text->3D flow. On 2026-09-07 the R2 credential stopped verifying and
// every signed operation began answering SignatureDoesNotMatch; this function
// threw, and because it runs BEFORE the reconstructor is ever called, 100% of
// text->3D returned 502 while image->3D (which supplies its own view URLs and
// never touches this path) kept working. Storage held the flagship flow hostage
// with no failover of any kind.
//
// Our own GPU workers do not need the bucket at all: they accept the view inline.
// So a rejected credential now costs a durable copy of the reference view, not
// the generation. Only a storage-INFRASTRUCTURE fault (credential rejected or
// revoked, bucket missing, endpoint unreachable) takes this path; a programming
// error still throws, and an oversized payload still throws rather than being
// smuggled into a request body.
export async function persistImageBytes(body) {
	const ext = sniffImageFormat(body);
	const key = `forge/refs/${globalThis.crypto.randomUUID()}.${ext}`;
	const contentType = ext === 'jpg' ? 'image/jpeg' : 'image/png';
	try {
		await putObject({ key, body, contentType });
	} catch (err) {
		if (!isStorageInfrastructureError(err)) throw err;
		if (!body || body.length > INLINE_FALLBACK_MAX_BYTES) throw err;
		console.warn(
			`[image-persist] object storage rejected the reference view (${String(err?.name || err?.Code || 'storage error')}); inlining ${body.length} B as a data URI so the generation continues`,
		);
		return `data:${contentType};base64,${Buffer.from(body).toString('base64')}`;
	}
	return publicUrl(key);
}

// Persist a base64-encoded image. Same behavior as persistImageBytes; kept as
// the named entry point the NIM and Vertex lanes already call.
export async function persistImageBase64(b64) {
	return persistImageBytes(Buffer.from(b64, 'base64'));
}
