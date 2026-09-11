#!/usr/bin/env node
// Upload a file to the R2 asset bucket and print the first-party CDN URL it is
// served from.
//
// Written for the OpenAI plugin submission, whose "Demo Recording URL" field
// takes a URL rather than a file upload, but it is deliberately generic: any
// asset that needs a stable public link on our own verified domain belongs here
// rather than on a third-party host.
//
//   node scripts/upload-demo-video.mjs demo.mp4
//   node scripts/upload-demo-video.mjs demo.mp4 --key demos/openai-plugin-2026-09.mp4
//
// Credentials come from the environment, or from the Cloud Run service when the
// environment does not carry them (S3_SECRET_ACCESS_KEY is a Secret Manager
// reference there, which `read-service-env.mjs` resolves). That means this works
// on a fresh machine carrying nothing but gcloud auth.
//
// Why /cdn/ rather than the bucket's own public domain: `api/cdn-object.js`
// fronts the bucket on three.ws with a long s-maxage, while the bucket's
// `*.r2.dev` domain is rate-limited. A reviewer clicking a rate-limited link
// sees a failure that looks like ours.

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);

const MIME = {
	'.mp4': 'video/mp4',
	'.mov': 'video/quicktime',
	'.webm': 'video/webm',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.pdf': 'application/pdf',
};

const REQUIRED = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const keyFlag = args.indexOf('--key');
if (!file) {
	console.error('usage: node scripts/upload-demo-video.mjs <file> [--key <key>]');
	process.exit(2);
}

/** Fill any missing credential from the Cloud Run service, which resolves Secret Manager refs. */
async function hydrateEnv() {
	const missing = REQUIRED.filter((n) => !process.env[n]);
	if (!missing.length) return;
	for (const name of missing) {
		const { stdout } = await run('node', ['scripts/read-service-env.mjs', `^${name}$`, '--raw'], {
			maxBuffer: 1024 * 1024,
		});
		const value = stdout.trim();
		if (!value || value.startsWith('FAILED')) {
			throw new Error(`${name} is not set locally and could not be read from the Cloud Run service`);
		}
		process.env[name] = value;
	}
}

await hydrateEnv();

// Imported AFTER the credentials are in place: api/_lib/env.js reads them when
// the storage client is first constructed. Reuses the same putObject the
// platform's own upload paths use rather than re-implementing request signing.
const { putObject } = await import('../api/_lib/r2.js');

const body = await readFile(file);
const contentType = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
// A random segment keeps a re-recorded take from being served from cache under
// the old URL, which is the failure mode of a fixed key behind a long s-maxage.
const key = keyFlag >= 0 ? args[keyFlag + 1] : `demos/${randomUUID().slice(0, 8)}-${basename(file)}`;

await putObject({ key, body, contentType });

const cdn = `https://three.ws/cdn/${key}`;
console.log(`uploaded ${(body.length / 1024 / 1024).toFixed(1)} MB as ${contentType}`);
console.log(cdn);

// Prove it before the URL goes into a submission form: a link that 404s for a
// reviewer is worse than no link at all.
const check = await fetch(cdn, { method: 'HEAD' });
console.log(check.ok ? `verified live (${check.status})` : `WARNING: ${cdn} returned ${check.status}`);
process.exit(check.ok ? 0 : 1);
