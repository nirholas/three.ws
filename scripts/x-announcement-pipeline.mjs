#!/usr/bin/env node

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyProblems, copySimilarity, weightedLength } from './lib/x-announcement-quality.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith('--')) || 'check';
const has = (flag) => args.includes(`--${flag}`);
const value = (name, fallback = null) => {
	const inline = args.find((arg) => arg.startsWith(`--${name}=`));
	if (inline) return inline.slice(name.length + 3);
	const index = args.indexOf(`--${name}`);
	return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};

const configPath = resolve(root, value('config', 'data/x-announcement-pipeline.json'));
const localStatePath = resolve(root, value('state', '.x-announcement-state.json'));
const config = JSON.parse(readFileSync(configPath, 'utf8'));

function textAt(path) {
	return readFileSync(resolve(root, path), 'utf8').trim();
}

function loadArchivePosts() {
	const paths = [
		'data/archives/trythreews_tweets_2026-06-03.json',
		'data/archives/trythreews_tweets_2026-05-16.json',
	];
	const posts = [];
	for (const path of paths) {
		if (!existsSync(resolve(root, path))) continue;
		const payload = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
		const rows = Array.isArray(payload) ? payload : payload.tweets || payload.data || [];
		for (const row of rows) {
			const text = row.text || row.full_text || row.tweet?.full_text || row.tweet?.text;
			if (text) posts.push(String(text));
		}
	}
	return posts;
}

function validate() {
	const errors = [];
	const notes = [];
	const heads = [];
	const ids = new Set();
	const allowedStatuses = new Set(['draft', 'review', 'approved', 'paused', 'posted']);

	for (const item of config.items || []) {
		const prefix = item.id || '<missing id>';
		if (!item.id || ids.has(item.id)) errors.push(`${prefix}: id is missing or duplicated`);
		ids.add(item.id);
		if (!allowedStatuses.has(item.status)) errors.push(`${prefix}: invalid status ${item.status}`);
		if (!item.lane || !item.pattern) errors.push(`${prefix}: lane and pattern are required`);
		if (!item.notBefore || !Number.isFinite(Date.parse(item.notBefore))) errors.push(`${prefix}: notBefore must be ISO-8601`);
		if (!Array.isArray(item.parts) || !item.parts.length) errors.push(`${prefix}: at least one post part is required`);
		if (!Array.isArray(item.media) || !item.media.length) errors.push(`${prefix}: every announcement requires media`);
		if ((item.media || []).length > 4) errors.push(`${prefix}: X accepts at most four images`);

		const mediaKinds = new Set();
		for (const media of item.media || []) {
			const path = resolve(root, media.path || '');
			if (!media.path || !existsSync(path)) errors.push(`${prefix}: missing media ${media.path || '<path>'}`);
			const extension = extname(media.path || '').toLowerCase();
			const kind = ['.mp4', '.mov'].includes(extension) ? 'video' : extension === '.gif' ? 'gif' : 'image';
			mediaKinds.add(kind);
			if (kind === 'image' && !String(media.alt || '').trim()) errors.push(`${prefix}: image ${media.path} needs alt text`);
		}
		if (mediaKinds.has('video') && (item.media.length !== 1 || mediaKinds.size !== 1)) errors.push(`${prefix}: video must be the only attachment`);
		if (mediaKinds.has('gif') && (item.media.length !== 1 || mediaKinds.size !== 1)) errors.push(`${prefix}: GIF must be the only attachment`);

		const parts = [];
		for (const partPath of item.parts || []) {
			if (!existsSync(resolve(root, partPath))) {
				errors.push(`${prefix}: missing post part ${partPath}`);
				continue;
			}
			parts.push(textAt(partPath));
		}
		for (let index = 0; index < parts.length; index++) {
			for (const problem of copyProblems(parts[index], { minimum: index === 0 ? 100 : 1 })) {
				errors.push(`${prefix} part ${index + 1}: ${problem}`);
			}
		}
		if (parts[0]) heads.push({ id: prefix, text: parts[0] });
	}

	const queueLimit = Number(config.quality?.queueSimilarityLimit ?? 0.34);
	for (let left = 0; left < heads.length; left++) {
		for (let right = left + 1; right < heads.length; right++) {
			const score = copySimilarity(heads[left].text, heads[right].text);
			if (score >= queueLimit) errors.push(`${heads[left].id} and ${heads[right].id}: queue similarity ${score.toFixed(2)} exceeds ${queueLimit}`);
		}
	}

	const archive = loadArchivePosts();
	const archiveLimit = Number(config.quality?.archiveSimilarityLimit ?? 0.42);
	for (const head of heads) {
		let closest = { score: 0, text: '' };
		for (const prior of archive) {
			const score = copySimilarity(head.text, prior);
			if (score > closest.score) closest = { score, text: prior };
		}
		if (closest.score >= archiveLimit) errors.push(`${head.id}: archive similarity ${closest.score.toFixed(2)} exceeds ${archiveLimit}`);
		else notes.push(`${head.id}: ${weightedLength(head.text)} chars, closest archive similarity ${closest.score.toFixed(2)}`);
	}

	return { errors, notes };
}

function printValidation(result) {
	for (const note of result.notes) console.log(`note  ${note}`);
	if (result.errors.length) {
		for (const error of result.errors) console.error(`error ${error}`);
		return false;
	}
	console.log(`x-announcement-pipeline: ${config.items.length} item(s) passed`);
	return true;
}

function r2Settings() {
	const accountId = process.env.R2_ACCOUNT_ID;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	const bucket = process.env.X_ANNOUNCEMENT_STATE_BUCKET;
	if (!(accountId && accessKeyId && secretAccessKey && bucket)) return null;
	return {
		bucket,
		key: process.env.X_ANNOUNCEMENT_STATE_KEY || 'state/x-announcements.json',
		client: new S3Client({
			region: 'auto',
			endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
			credentials: { accessKeyId, secretAccessKey },
		}),
	};
}

async function bodyText(body) {
	if (!body) return '';
	if (typeof body.transformToString === 'function') return body.transformToString();
	const chunks = [];
	for await (const chunk of body) chunks.push(chunk);
	return Buffer.concat(chunks).toString('utf8');
}

async function loadState() {
	const remote = r2Settings();
	if (remote) {
		try {
			const object = await remote.client.send(new GetObjectCommand({ Bucket: remote.bucket, Key: remote.key }));
			return JSON.parse(await bodyText(object.Body));
		} catch (error) {
			if (error?.name !== 'NoSuchKey' && error?.$metadata?.httpStatusCode !== 404) throw error;
			return { version: 1, published: [] };
		}
	}
	if (!existsSync(localStatePath)) return { version: 1, published: [] };
	return JSON.parse(readFileSync(localStatePath, 'utf8'));
}

async function saveState(state) {
	const serialized = `${JSON.stringify(state, null, '\t')}\n`;
	const remote = r2Settings();
	if (remote) {
		await remote.client.send(new PutObjectCommand({
			Bucket: remote.bucket,
			Key: remote.key,
			Body: serialized,
			ContentType: 'application/json',
		}));
		return;
	}
	writeFileSync(localStatePath, serialized);
}

function publisherArgs(item, dryRun) {
	const publishArgs = ['scripts/post-tweet.mjs'];
	if (item.parts.length === 1) publishArgs.push('--file', item.parts[0]);
	else publishArgs.push('--thread', JSON.stringify(item.parts));
	for (const media of item.media) {
		publishArgs.push('--media', media.path);
		if (media.alt) publishArgs.push('--alt', media.alt);
	}
	if (dryRun) publishArgs.push('--dry-run');
	return publishArgs;
}

function showPlan() {
	for (const item of [...config.items].sort((a, b) => a.notBefore.localeCompare(b.notBefore))) {
		console.log(`${item.notBefore}  ${item.status.padEnd(8)}  ${item.lane.padEnd(10)}  ${item.pattern.padEnd(10)}  ${item.id}`);
	}
}

async function run() {
	const check = validate();
	if (!printValidation(check)) process.exit(1);
	const state = await loadState();
	const published = new Set((state.published || []).map((row) => row.id));
	const requested = value('id');
	const now = Date.parse(value('now', new Date().toISOString()));
	const item = [...config.items]
		.filter((row) => row.status === 'approved')
		.filter((row) => !published.has(row.id))
		.filter((row) => !requested || row.id === requested)
		.filter((row) => requested || Date.parse(row.notBefore) <= now)
		.sort((a, b) => a.notBefore.localeCompare(b.notBefore))[0];
	if (!item) {
		console.log(requested ? `No approved unpublished item named ${requested}.` : 'No approved announcement is due.');
		return;
	}

	const dryRun = has('dry-run');
	console.log(`${dryRun ? 'Previewing' : 'Publishing'} ${item.id} (${item.lane}/${item.pattern})`);
	const result = spawnSync(process.execPath, publisherArgs(item, dryRun), { cwd: root, encoding: 'utf8', stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status || 1);
	if (dryRun) return;
	state.published = [
		...(state.published || []),
		{ id: item.id, publishedAt: new Date().toISOString(), lane: item.lane, pattern: item.pattern },
	];
	await saveState(state);
	console.log(`Recorded ${item.id} in ${r2Settings() ? 'R2' : localStatePath}`);
}

if (command === 'check') {
	if (!printValidation(validate())) process.exit(1);
} else if (command === 'plan') {
	showPlan();
} else if (command === 'run') {
	await run();
} else {
	console.error('Usage: node scripts/x-announcement-pipeline.mjs <check|plan|run> [--dry-run] [--id slug]');
	process.exit(1);
}

