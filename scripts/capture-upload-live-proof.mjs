#!/usr/bin/env node
// Live proof of the capture-upload API (contract C4) against a running server and
// the real R2 bucket: uploads a large file through create / sign / parts /
// complete, SIGKILLs itself mid-upload, resumes by asking R2 which parts it has
// and re-signing only the missing ones, then downloads the object back and
// compares SHA-256 with the local file. Deletes the test object afterwards.
//
//   node scripts/capture-upload-live-proof.mjs --base http://localhost:3338 \
//     --key-file <api key file> --file <path> [--content-type video/mp4]
//     [--crash-after 40] [--concurrency 6]
//
// Needs S3_* in the environment (only for deleting the test object at the end).
// Prints one JSON report line.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync, openSync, readSync, closeSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = flag('--base', 'http://localhost:3338').replace(/\/$/, '');
const FILE = flag('--file');
const CONTENT_TYPE = flag('--content-type', 'video/mp4');
const CRASH_AFTER = Number(flag('--crash-after', 0));
const CONCURRENCY = Number(flag('--concurrency', 6));
const STATE = flag('--state');
const RESUME = args.includes('--resume');
const TOKEN = readFileSync(flag('--key-file'), 'utf8').trim();

if (!FILE || !existsSync(FILE)) {
	process.stderr.write('--file <existing path> is required\n');
	process.exit(2);
}
const SIZE = statSync(FILE).size;

async function api(name, body) {
	const res = await fetch(`${BASE}/api/capture-upload/${name}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
		body: JSON.stringify(body),
	});
	const out = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`${name} ${res.status} ${out.error}: ${out.message}`);
	return out;
}

function readPart(partNumber, partSize) {
	const start = (partNumber - 1) * partSize;
	const len = Math.min(partSize, SIZE - start);
	const buf = Buffer.allocUnsafe(len);
	const fd = openSync(FILE, 'r');
	try {
		readSync(fd, buf, 0, len, start);
	} finally {
		closeSync(fd);
	}
	return buf;
}

function saveState(state) {
	if (!STATE) return;
	writeFileSync(STATE, JSON.stringify(state));
}

async function sha256File(file) {
	const h = createHash('sha256');
	for await (const chunk of createReadStream(file)) h.update(chunk);
	return h.digest('hex');
}

async function pool(items, worker) {
	const queue = [...items];
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
			while (queue.length) await worker(queue.shift());
		}),
	);
}

async function sendParts(state, numbers) {
	for (let i = 0; i < numbers.length; i += 100) {
		const batch = numbers.slice(i, i + 100);
		const { urls } = await api('sign', { upload_id: state.upload_id, key: state.key, part_numbers: batch });
		await pool(batch, async (n) => {
			for (let attempt = 1; ; attempt++) {
				try {
					const res = await fetch(urls[String(n)], { method: 'PUT', body: readPart(n, state.part_size) });
					if (!res.ok) throw new Error(`part ${n} PUT ${res.status}`);
					const etag = res.headers.get('etag');
					if (!etag) throw new Error(`part ${n} returned no ETag`);
					state.parts[n] = etag;
					saveState(state);
					if (CRASH_AFTER && Object.keys(state.parts).length >= CRASH_AFTER) process.kill(process.pid, 'SIGKILL');
					return;
				} catch (err) {
					if (attempt >= 4) throw err;
				}
			}
		});
	}
}

async function child() {
	const created = await api('create', { filename: path.basename(FILE), content_type: CONTENT_TYPE, size_bytes: SIZE, kind: 'pano' });
	const state = { ...created, parts: {} };
	saveState(state);
	await sendParts(state, Array.from({ length: created.part_count }, (_, i) => i + 1));
}

async function main() {
	const dir = mkdtempSync(path.join(tmpdir(), 'capture-proof-'));
	const stateFile = path.join(dir, 'state.json');
	const crashAfter = Number(flag('--crash-total', 40));
	const t0 = Date.now();

	const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, '--state', stateFile, '--crash-after', String(crashAfter)], { stdio: 'inherit' });
	const exit = await new Promise((r) => proc.on('exit', (code, signal) => r({ code, signal })));
	const state = JSON.parse(readFileSync(stateFile, 'utf8'));
	const firstRunBytes = Object.keys(state.parts).reduce((s, n) => s + Math.min(state.part_size, SIZE - (n - 1) * state.part_size), 0);
	const tCrash = Date.now();

	const listed = await api('parts', { upload_id: state.upload_id, key: state.key });
	const have = new Set(listed.parts.map((p) => p.part_number));
	const missing = Array.from({ length: state.part_count }, (_, i) => i + 1).filter((n) => !have.has(n));
	for (const p of listed.parts) state.parts[p.part_number] = p.etag;
	const t1 = Date.now();
	await sendParts({ ...state, parts: state.parts }, missing);
	const tUp = Date.now();

	const parts = Object.entries(state.parts).map(([n, etag]) => ({ part_number: Number(n), etag }));
	const done = await api('complete', { upload_id: state.upload_id, key: state.key, parts });

	const localSha = await sha256File(FILE);
	const t2 = Date.now();
	const res = await fetch(done.source_url);
	if (!res.ok) throw new Error(`download ${res.status}`);
	const h = createHash('sha256');
	let got = 0;
	for await (const chunk of res.body) {
		h.update(chunk);
		got += chunk.length;
	}
	const remoteSha = h.digest('hex');
	const tDl = Date.now();

	const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
	const s3 = new S3Client({ region: 'auto', endpoint: process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
	await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: state.key }));

	const mbps = (bytes, ms) => +(bytes / 1e6 / (ms / 1000)).toFixed(1);
	const report = {
		file: path.basename(FILE),
		size_bytes: SIZE,
		part_size: state.part_size,
		part_count: state.part_count,
		first_run_killed: exit.signal === 'SIGKILL',
		parts_before_kill: Object.keys(JSON.parse(readFileSync(stateFile, 'utf8')).parts).length,
		parts_reported_by_r2_after_kill: listed.parts.length,
		parts_re_signed_on_resume: missing.length,
		first_run_MBps: mbps(firstRunBytes, tCrash - t0),
		resume_upload_MBps: mbps(SIZE - listed.parts.reduce((s, p) => s + p.size, 0), tUp - t1),
		download_MBps: mbps(got, tDl - t2),
		sha256_local: localSha,
		sha256_roundtrip: remoteSha,
		identical: localSha === remoteSha && got === SIZE && done.size_bytes === SIZE,
		object_deleted: true,
	};
	process.stdout.write(`${JSON.stringify(report)}\n`);
	process.exit(report.identical && report.first_run_killed && missing.length > 0 && missing.length < state.part_count ? 0 : 1);
}

if (STATE && !RESUME) {
	child().catch((err) => {
		process.stderr.write(`${err.message}\n`);
		process.exit(1);
	});
} else {
	main().catch((err) => {
		process.stderr.write(`${err.stack || err.message}\n`);
		process.exit(1);
	});
}
