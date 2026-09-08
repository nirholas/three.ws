// Shared image persistence (api/_lib/image-persist.js) unit tests. The module
// is the single home for the "every generated image becomes a durable R2 URL"
// rule the NIM FLUX lane, the Vertex reference-image lane, and the Livepeer
// federation provider all share.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
	looksLikeImageBytes,
	sniffImageFormat,
	persistImageBase64,
	persistImageBytes,
	isInlineImageRef,
} from '../api/_lib/image-persist.js';
import { putObject, publicUrl } from '../api/_lib/r2.js';

// The real classifier, not a stub: the fallback is only correct if it fires on
// the exact error shapes S3 actually throws, and that mapping lives in r2.js.
const STORAGE_ERROR_RE =
	/missing required env var: s3_|invalidaccesskeyid|signaturedoesnotmatch|does not match the signature|unauthorized|nosuchbucket|access denied|econnrefused|enotfound|socket hang up|econnreset/i;

vi.mock('../api/_lib/r2.js', () => ({
	putObject: vi.fn(async () => ({})),
	publicUrl: vi.fn((key) => `https://cdn.example.com/${key}`),
	isStorageInfrastructureError: vi.fn((err) =>
		STORAGE_ERROR_RE.test([err?.name, err?.Code, err?.message].filter(Boolean).join(' ')),
	),
}));

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0];

beforeEach(() => {
	vi.clearAllMocks();
});
afterEach(() => {
	vi.resetAllMocks();
});

describe('sniffImageFormat', () => {
	it('detects JPEG from the FF D8 FF magic header', () => {
		expect(sniffImageFormat(Buffer.from([...JPEG_SIG, 0, 1, 2]))).toBe('jpg');
	});

	it('labels everything else png (the legacy default)', () => {
		expect(sniffImageFormat(Buffer.from([...PNG_SIG]))).toBe('png');
		expect(sniffImageFormat(Buffer.from([0x00, 0x01]))).toBe('png');
	});
});

describe('looksLikeImageBytes', () => {
	it('accepts real JPEG and PNG signatures', () => {
		expect(looksLikeImageBytes(Buffer.from([...JPEG_SIG, 0, 1]))).toBe(true);
		expect(looksLikeImageBytes(Buffer.from([...PNG_SIG, 0, 1]))).toBe(true);
	});

	it('rejects text, tiny payloads, and empty buffers', () => {
		expect(looksLikeImageBytes(Buffer.from('<html>error</html>'))).toBe(false);
		expect(looksLikeImageBytes(Buffer.from([0xff]))).toBe(false);
		expect(looksLikeImageBytes(Buffer.alloc(0))).toBe(false);
		expect(looksLikeImageBytes(null)).toBe(false);
	});
});

describe('persistImageBytes', () => {
	it('writes under forge/refs/ with a sniffed extension and content type', async () => {
		const body = Buffer.from([...JPEG_SIG, 9, 9, 9]);
		const url = await persistImageBytes(body);
		const call = putObject.mock.calls[0][0];
		expect(call.key).toMatch(/^forge\/refs\/[0-9a-f-]+\.jpg$/);
		expect(call.contentType).toBe('image/jpeg');
		expect(Buffer.compare(call.body, body)).toBe(0);
		expect(url).toBe(`https://cdn.example.com/${call.key}`);
	});

	it('keeps png labeling for non-JPEG payloads', async () => {
		const body = Buffer.from([...PNG_SIG, 9, 9, 9]);
		await persistImageBytes(body);
		const call = putObject.mock.calls[0][0];
		expect(call.key).toMatch(/\.png$/);
		expect(call.contentType).toBe('image/png');
	});
});

describe('persistImageBase64', () => {
	it('decodes base64 and persists the decoded bytes', async () => {
		const body = Buffer.from([...PNG_SIG, 1, 2, 3, 4]);
		await persistImageBase64(body.toString('base64'));
		const call = putObject.mock.calls[0][0];
		expect(Buffer.compare(call.body, body)).toBe(0);
	});
});


// The 2026-09-07 outage: the R2 credential stopped verifying, this write threw,
// and because it runs before the reconstructor is ever called, 100% of text->3D
// answered 502 while image->3D kept working. Our own workers accept the view
// inline, so storage must no longer be able to hold the whole flow hostage.
describe('persistImageBytes when object storage is down', () => {
	const PNG = Buffer.from([...PNG_SIG, 1, 2, 3, 4, 5]);

	it('inlines the view as a data URI when the credential is rejected', async () => {
		putObject.mockRejectedValueOnce(
			Object.assign(new Error('The request signature we calculated does not match the signature you provided.'), {
				name: 'SignatureDoesNotMatch',
			}),
		);
		const url = await persistImageBytes(PNG);
		expect(url).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
		expect(isInlineImageRef(url)).toBe(true);
	});

	it('inlines a revoked key and an unreachable endpoint too', async () => {
		for (const err of [
			Object.assign(new Error('Unauthorized'), { name: 'Unauthorized' }),
			Object.assign(new Error('getaddrinfo ENOTFOUND bucket.example.com'), { name: 'Error' }),
		]) {
			putObject.mockRejectedValueOnce(err);
			expect(isInlineImageRef(await persistImageBytes(PNG))).toBe(true);
		}
	});

	it('keeps the JPEG content type in the inlined URI', async () => {
		const jpeg = Buffer.from([...JPEG_SIG, 7, 7, 7]);
		putObject.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'SignatureDoesNotMatch' }));
		expect(await persistImageBytes(jpeg)).toBe(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
	});

	it('rethrows a programming error instead of hiding it behind a data URI', async () => {
		putObject.mockRejectedValueOnce(new TypeError('body.pipe is not a function'));
		await expect(persistImageBytes(PNG)).rejects.toThrow('body.pipe is not a function');
	});

	it('refuses to inline a payload too large to be a request body', async () => {
		const huge = Buffer.alloc(5 * 1024 * 1024, 0x41);
		PNG_SIG.forEach((b, i) => (huge[i] = b));
		putObject.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'SignatureDoesNotMatch' }));
		await expect(persistImageBytes(huge)).rejects.toThrow(/nope/);
	});

	it('still returns the durable URL when the bucket is healthy', async () => {
		const url = await persistImageBytes(PNG);
		expect(url).toMatch(/^https:\/\/cdn\.example\.com\/forge\/refs\//);
		expect(isInlineImageRef(url)).toBe(false);
	});
});

describe('isInlineImageRef', () => {
	it('recognises only an inline image payload', () => {
		expect(isInlineImageRef('data:image/png;base64,AAAA')).toBe(true);
		expect(isInlineImageRef('https://cdn.example.com/a.png')).toBe(false);
		expect(isInlineImageRef('data:text/plain;base64,AAAA')).toBe(false);
		expect(isInlineImageRef(null)).toBe(false);
		expect(isInlineImageRef(undefined)).toBe(false);
	});
});
