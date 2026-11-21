'use strict';

/**
 * Drive the panel's client code against a running three.ws API (the real api/capture-upload
 * and api/pano-capture handlers on the real R2 bucket), with a real file on disk.
 *
 *   node scripts/live-proof.js --base http://localhost:3344 --key-file <file> --file <path.mp4> [--delete-object]
 *
 * Proves: multipart upload with 4 parts in flight, a crash mid-upload followed by a resume that
 * only sends the missing parts, byte-identical download of the stored object, and how a real
 * server error maps to the panel's visitor message. Prints one JSON line.
 * --delete-object needs S3_* in the environment and removes the test object afterwards.
 */

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { createClient } = require('../src/core/client');
const { uploadFile } = require('../src/core/upload');
const { CancelToken } = require('../src/core/retry');
const { ApiError } = require('../src/core/errors');
const { probeDimensions } = require('../src/core/probe');
const { classifyFile } = require('../src/core/detect');

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

async function localFile(p) {
	const st = await fsp.stat(p);
	return {
		name: path.basename(p),
		size: st.size,
		mtimeMs: st.mtimeMs,
		contentType: 'video/mp4',
		async readRange(start, end) {
			const fh = await fsp.open(p, 'r');
			try {
				const buf = Buffer.alloc(end - start);
				await fh.read(buf, 0, buf.length, start);
				return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
			} finally {
				await fh.close();
			}
		},
	};
}

function sha256File(p) {
	return new Promise((resolve, reject) => {
		const h = crypto.createHash('sha256');
		fs.createReadStream(p).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
	});
}

(async () => {
	const base = flag('--base');
	const key = fs.readFileSync(flag('--key-file'), 'utf8').trim();
	const filePath = flag('--file');
	const file = await localFile(filePath);
	const client = createClient({ origin: base, getKey: async () => key });
	const store = new Map();
	const memStore = {
		load: async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null),
		save: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
		remove: async (k) => void store.delete(k),
	};

	const dims = await probeDimensions(file.name, file.size, file.readRange);
	const kind = classifyFile({ name: file.name, ...dims });

	let puts = 0;
	let crashed = false;
	const crashingFetch = async (url, init) => {
		if (init && init.method === 'PUT') {
			puts++;
			if (puts >= 2) throw new ApiError('crash', 'simulated crash', { retryable: false });
		}
		return fetch(url, init);
	};
	try {
		await uploadFile({ client, file, store: memStore, token: new CancelToken(), fetchImpl: crashingFetch });
	} catch (e) {
		crashed = e.code === 'crash';
	}
	if (!crashed) throw new Error('the simulated crash did not happen');
	const saved = [...store.values()][0];
	if (!saved) throw new Error('no resume state was saved');

	let resumedPuts = 0;
	const countingFetch = async (url, init) => {
		if (init && init.method === 'PUT') resumedPuts++;
		return fetch(url, init);
	};
	const t0 = Date.now();
	const done = await uploadFile({ client, file, store: memStore, token: new CancelToken(), fetchImpl: countingFetch });
	const resumeMs = Date.now() - t0;

	const dl = await fetch(done.source_url);
	const hash = crypto.createHash('sha256');
	let n = 0;
	for await (const chunk of dl.body) {
		hash.update(chunk);
		n += chunk.length;
	}
	const [localSha, remoteSha] = [await sha256File(filePath), hash.digest('hex')];

	let startError = null;
	try {
		await client.startCapture({ source_url: done.source_url, source_kind: kind.source_kind, quality: 'standard' });
		startError = 'accepted';
	} catch (e) {
		startError = { code: e.code, status: e.status, message: e.message };
	}

	let listed = null;
	try {
		listed = (await client.listCaptures()).captures.length;
	} catch (e) {
		listed = { code: e.code };
	}

	if (args.includes('--delete-object')) {
		const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
		const s3 = new S3Client({ region: 'auto', endpoint: process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
		await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: saved.upload.key }));
	}

	console.log(
		JSON.stringify({
			file: file.name,
			bytes: file.size,
			dimensions: dims,
			lane: kind.lane,
			is360: kind.is360,
			parts: saved.upload.part_count,
			partSize: saved.upload.part_size,
			putsBeforeCrash: puts,
			partsOnServerAfterCrash: done.resumed_parts,
			putsAfterResume: resumedPuts,
			resumeMs,
			downloadedBytes: n,
			sha256Match: localSha === remoteSha,
			sha256: localSha,
			startCaptureResult: startError,
			listCapturesResult: listed,
			objectDeleted: args.includes('--delete-object'),
		}),
	);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
