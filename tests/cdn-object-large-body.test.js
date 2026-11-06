/**
 * /cdn/<key> serving objects larger than Cloud Run's 32 MiB response cap.
 *
 * Cloud Run answers a buffered HTTP/1 response above 32 MiB with an empty 500
 * ("Response size was too large") and no application log line. A response with
 * a fixed `content-length` is buffered, so a full GET of any large GLB (the
 * 38-42 MB forge props and mixamo avatars used in /play) failed with that 500
 * whenever the CDN edge missed, while Range reads and HEADs kept working. A
 * body without `content-length` is sent chunked, which Cloud Run streams.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable, Writable } from 'node:stream';

const send = vi.fn();
vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, r2: { send: (...args) => send(...args) } };
});

const { default: handler } = await import('../api/cdn-object.js');

function makeRes() {
	const res = new Writable({
		write(_c, _e, cb) {
			cb();
		},
	});
	res.statusCode = 200;
	res.headers = {};
	res.setHeader = (k, v) => {
		res.headers[k.toLowerCase()] = String(v);
	};
	res.getHeader = (k) => res.headers[k.toLowerCase()];
	res.removeHeader = (k) => {
		delete res.headers[k.toLowerCase()];
	};
	return res;
}

const req = (key, headers = {}, method = 'GET') => ({ method, url: `/api/cdn-object?key=${key}`, headers, query: { key } });
const object = (len, extra = {}) => ({ ContentLength: len, ETag: '"e"', Body: Readable.from([Buffer.from('x')]), ...extra });
const run = async (r) => {
	const res = makeRes();
	await handler(r, res);
	await new Promise((ok) => setTimeout(ok, 20));
	return res;
};

beforeEach(() => {
	process.env.S3_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
	process.env.S3_BUCKET = 'three-ws';
	process.env.S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
	process.env.S3_SECRET_ACCESS_KEY = 'secret';
	send.mockReset();
});

describe('/cdn full reads above the Cloud Run response cap', () => {
	it('drops content-length for a 42 MB full GET so the body streams chunked', async () => {
		send.mockResolvedValue(object(41_965_052));
		const res = await run(req('avatars/mixamo/glb/sophie.glb'));
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-length']).toBeUndefined();
	});

	it('keeps content-length for objects under the cap', async () => {
		send.mockResolvedValue(object(2_000_000));
		const res = await run(req('forge/anon/small.glb'));
		expect(res.headers['content-length']).toBe('2000000');
	});

	it('keeps content-length on a ranged read of a large object', async () => {
		send.mockResolvedValue(object(1024, { ContentRange: 'bytes 0-1023/41965052' }));
		const res = await run(req('avatars/mixamo/glb/sophie.glb', { range: 'bytes=0-1023' }));
		expect(res.statusCode).toBe(206);
		expect(res.headers['content-length']).toBe('1024');
	});

	it('keeps content-length on HEAD of a large object', async () => {
		send.mockResolvedValue(object(41_965_052));
		const res = await run(req('avatars/mixamo/glb/sophie.glb', {}, 'HEAD'));
		expect(res.headers['content-length']).toBe('41965052');
	});
});
