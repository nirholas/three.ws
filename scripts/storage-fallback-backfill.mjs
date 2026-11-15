#!/usr/bin/env node
/**
 * Copy objects that were diverted to the GCS fallback bucket back into R2.
 *
 * While R2 refuses our credential, api/_lib/r2.js writes into
 * STORAGE_FALLBACK_BUCKET under the same key (see api/_lib/storage-fallback.js),
 * and /cdn keeps serving those keys from GCS. Once R2 answers again, run this to
 * move them home, so R2 is once more the single source of every object.
 *
 *   node --env-file=.env.local scripts/storage-fallback-backfill.mjs --dry-run
 *   node --env-file=.env.local scripts/storage-fallback-backfill.mjs
 *   node --env-file=.env.local scripts/storage-fallback-backfill.mjs --delete-after
 *
 * An object R2 already holds at the same size is skipped. --delete-after removes
 * the GCS copy only after a HEAD on R2 confirms the copied size, so nothing is
 * deleted that R2 cannot serve. Reads keep falling back to GCS for any key the
 * run did not move, so a partial run is safe to repeat.
 *
 * Needs S3_* (R2) and STORAGE_FALLBACK_BUCKET in the env, plus GCP credentials
 * (ADC on a developer box: `gcloud auth application-default login`).
 */
import { pathToFileURL } from 'node:url';

const GCS_JSON = 'https://storage.googleapis.com/storage/v1';

/**
 * Pure orchestration, injected I/O, so it is testable without either store.
 * @param {{
 *   list: () => AsyncIterable<{ name: string, size: number }>,
 *   r2Head: (key: string) => Promise<{ ContentLength?: number } | null>,
 *   r2Put: (obj: { key: string, body: Buffer, contentType?: string|null, metadata?: Record<string,string> }) => Promise<void>,
 *   gcsGet: (key: string) => Promise<{ body: Buffer, contentType?: string|null, metadata?: Record<string,string> } | null>,
 *   gcsDelete: (key: string) => Promise<void>,
 *   dryRun?: boolean,
 *   deleteAfter?: boolean,
 *   log?: (line: string) => void,
 * }} io
 */
export async function backfill({ list, r2Head, r2Put, gcsGet, gcsDelete, dryRun = false, deleteAfter = false, log = () => {} }) {
	const tally = { seen: 0, copied: 0, skipped: 0, deleted: 0, failed: 0 };
	for await (const item of list()) {
		tally.seen += 1;
		try {
			const existing = await r2Head(item.name);
			const alreadyHome = existing && Number(existing.ContentLength) === Number(item.size);
			if (!alreadyHome) {
				if (dryRun) {
					log(`would copy ${item.name} (${item.size} bytes)`);
					tally.copied += 1;
					continue;
				}
				const obj = await gcsGet(item.name);
				if (!obj) {
					log(`vanished before copy: ${item.name}`);
					tally.skipped += 1;
					continue;
				}
				await r2Put({ key: item.name, body: obj.body, contentType: obj.contentType, metadata: obj.metadata });
				tally.copied += 1;
				log(`copied ${item.name} (${obj.body.length} bytes)`);
			} else {
				tally.skipped += 1;
			}
			if (deleteAfter && !dryRun) {
				const verify = await r2Head(item.name);
				if (verify && Number(verify.ContentLength) === Number(item.size)) {
					await gcsDelete(item.name);
					tally.deleted += 1;
				} else {
					log(`kept GCS copy of ${item.name}: R2 size did not verify`);
				}
			}
		} catch (err) {
			tally.failed += 1;
			log(`failed ${item.name}: ${err?.name || 'Error'}: ${String(err?.message || err).slice(0, 200)}`);
		}
	}
	return tally;
}

async function* listBucket(bucket, token) {
	let pageToken = '';
	do {
		const url = new URL(`${GCS_JSON}/b/${encodeURIComponent(bucket)}/o`);
		url.searchParams.set('fields', 'items(name,size),nextPageToken');
		url.searchParams.set('maxResults', '1000');
		if (pageToken) url.searchParams.set('pageToken', pageToken);
		const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
		if (!res.ok) throw new Error(`list ${bucket} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
		const page = await res.json();
		for (const item of page.items || []) yield { name: item.name, size: Number(item.size) };
		pageToken = page.nextPageToken || '';
	} while (pageToken);
}

async function main() {
	const args = new Set(process.argv.slice(2));
	const dryRun = args.has('--dry-run');
	const deleteAfter = args.has('--delete-after');

	const { fallbackBucket, fallbackGet, fallbackDelete } = await import('../api/_lib/storage-fallback.js');
	const { getGcpAccessToken } = await import('../api/_lib/gcp-auth.js');
	const { r2 } = await import('../api/_lib/r2.js');
	const { env } = await import('../api/_lib/env.js');
	const { HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');

	const bucket = fallbackBucket();
	if (!bucket) {
		console.error('STORAGE_FALLBACK_BUCKET is not set; there is no fallback bucket to drain.');
		process.exit(2);
	}

	// Refuse to start while R2 still rejects us: every copy would fail, and a
	// plain putObject() would just divert the bytes back into the same bucket.
	try {
		await r2.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: 'ops/backfill-preflight' }));
	} catch (err) {
		const status = err?.$metadata?.httpStatusCode;
		if (status !== 404) {
			console.error(`R2 is not healthy yet (${err?.name || 'Error'} ${status ?? ''}); fix the credential first.`);
			process.exit(1);
		}
	}

	const token = await getGcpAccessToken();
	const tally = await backfill({
		list: () => listBucket(bucket, token),
		r2Head: async (key) => {
			try {
				return await r2.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
			} catch (err) {
				if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
				throw err;
			}
		},
		r2Put: ({ key, body, contentType, metadata }) =>
			r2.send(
				new PutObjectCommand({
					Bucket: env.S3_BUCKET,
					Key: key,
					Body: body,
					ContentType: contentType || 'application/octet-stream',
					Metadata: metadata,
				}),
			),
		gcsGet: (key) => fallbackGet(key),
		gcsDelete: (key) => fallbackDelete(key),
		dryRun,
		deleteAfter,
		log: (line) => console.log(line),
	});
	console.log(`\n${dryRun ? '[dry run] ' : ''}gs://${bucket} -> R2 ${env.S3_BUCKET}: ${JSON.stringify(tally)}`);
	if (tally.failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
