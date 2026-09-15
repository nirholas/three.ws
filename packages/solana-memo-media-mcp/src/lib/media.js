import { createHash } from 'node:crypto';

export const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_MEDIA_BYTES = 262_144;
const DATA_URI = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i;

function bad(message, code = 'invalid_data_uri') {
	const error = new Error(message);
	error.code = code;
	return error;
}

function assertCanonicalBase64(value) {
	if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
		throw bad('The data URI must contain padded, canonical base64.');
	}
}

function pngDimensions(bytes) {
	if (bytes.length < 24) return null;
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function gifDimensions(bytes) {
	if (bytes.length < 10) return null;
	return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function jpegDimensions(bytes) {
	let offset = 2;
	while (offset + 9 < bytes.length) {
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1];
		offset += 2;
		if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		const length = bytes.readUInt16BE(offset);
		if (length < 2 || offset + length > bytes.length) return null;
		if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
			return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
		}
		offset += length;
	}
	return null;
}

function inspectMagic(type, bytes) {
	if (type === 'image/png') {
		if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw bad('Bytes do not have a PNG signature.', 'media_signature_mismatch');
		return pngDimensions(bytes);
	}
	if (type === 'image/jpeg') {
		if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw bad('Bytes do not have a JPEG signature.', 'media_signature_mismatch');
		return jpegDimensions(bytes);
	}
	if (type === 'image/gif') {
		if (!['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) throw bad('Bytes do not have a GIF signature.', 'media_signature_mismatch');
		return gifDimensions(bytes);
	}
	if (type === 'image/webp') {
		if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') throw bad('Bytes do not have a WebP signature.', 'media_signature_mismatch');
		return null;
	}
	return null;
}

export function decodeDataUri(dataUri, { maxBytes = MAX_MEDIA_BYTES } = {}) {
	if (typeof dataUri !== 'string') throw bad('dataUri must be a string.');
	const match = DATA_URI.exec(dataUri.trim());
	if (!match) throw bad('Expected a base64 data URI such as data:image/png;base64,...');
	const mimeType = match[1].toLowerCase();
	if (!ALLOWED_MEDIA_TYPES.has(mimeType)) throw bad(`Unsupported media type: ${mimeType}.`, 'unsupported_media_type');
	assertCanonicalBase64(match[2]);
	const expectedBytes = (match[2].length / 4) * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
	if (expectedBytes > maxBytes) throw bad(`Decoded media exceeds the ${maxBytes}-byte limit.`, 'media_too_large');
	const bytes = Buffer.from(match[2], 'base64');
	const dimensions = inspectMagic(mimeType, bytes);
	return {
		mimeType,
		base64: match[2],
		bytes,
		byteLength: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		dimensions,
	};
}

export function mediaMetadata(media, extra = {}) {
	return { mime_type: media.mimeType, byte_length: media.byteLength, sha256: media.sha256, dimensions: media.dimensions, ...extra };
}
