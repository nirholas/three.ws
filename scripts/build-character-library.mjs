#!/usr/bin/env node
/**
 * Publish the character library manifest to R2, so `GET /api/avatars/library`
 * can serve it.
 *
 * Reads public/avatars/extra/characters.json (the openly licensed, CC0
 * characters whose GLB + thumbnail bytes are already on R2), builds one manifest
 * entry per character with absolute CDN urls, and PUTs
 *   avatars/library/manifest.json
 * to R2. Only the index is published here.
 *
 * Adobe Mixamo characters are intentionally not part of the library: Mixamo's
 * terms do not allow redistributing its characters as standalone downloads.
 *
 * Manifest shape (consumed by api/avatars/library.js):
 *   { generated_at, total, sources, avatars: [ { name, label, url, thumb, bytes, skins, animations, source, license } ] }
 *
 * Usage:
 *   node scripts/build-character-library.mjs
 *   node scripts/build-character-library.mjs --dry-run   # print, don't upload
 *
 * Needs the S3_* (R2) creds the other library scripts use.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

function loadEnvVar(key) {
	if (process.env[key]) return process.env[key].trim();
	const p = join(ROOT, '.env.local');
	if (existsSync(p)) {
		const line = readFileSync(p, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
		if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
	}
	return null;
}

const S3_ENDPOINT = loadEnvVar('S3_ENDPOINT') ||
	(loadEnvVar('R2_ACCOUNT_ID') ? `https://${loadEnvVar('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com` : null);
const S3_ACCESS_KEY_ID = loadEnvVar('S3_ACCESS_KEY_ID') || loadEnvVar('R2_ACCESS_KEY_ID');
const S3_SECRET_ACCESS_KEY = loadEnvVar('S3_SECRET_ACCESS_KEY') || loadEnvVar('R2_SECRET_ACCESS_KEY');
const S3_BUCKET = loadEnvVar('S3_BUCKET') || loadEnvVar('R2_BUCKET') || 'test';
const S3_PUBLIC_DOMAIN = (loadEnvVar('S3_PUBLIC_DOMAIN') || '').replace(/\/+$/, '');

if (!S3_PUBLIC_DOMAIN) {
	console.error('S3_PUBLIC_DOMAIN missing: needed to build absolute CDN urls.');
	process.exit(1);
}
if (!DRY && (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)) {
	console.error('R2 creds missing: need S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.');
	process.exit(1);
}

const cdn = (key) => `${S3_PUBLIC_DOMAIN}/${key}`;
const EXTRA_PATH = join(ROOT, 'public', 'avatars', 'extra', 'characters.json');
const extra = JSON.parse(readFileSync(EXTRA_PATH, 'utf8')).characters || [];

const avatars = extra
	.filter((e) => e.glb_file && !/mixamo/i.test(`${e.source} ${e.license} ${e.glb_file}`))
	.map((e) => ({
		name: e.name,
		label: e.label || e.name,
		url: cdn(e.glb_file),
		...(e.thumb_file ? { thumb: cdn(e.thumb_file) } : {}),
		bytes: e.glb_bytes || 0,
		skins: e.skins ?? 1,
		animations: e.animations ?? 0,
		source: e.source || 'extra',
		license: e.license || 'CC0',
	}))
	.sort((a, b) => a.label.localeCompare(b.label));

const manifest = {
	generated_at: new Date().toISOString(),
	total: avatars.length,
	sources: [...new Set(avatars.map((a) => a.source))],
	avatars,
};

const MANIFEST_KEY = 'avatars/library/manifest.json';

if (DRY) {
	console.log(JSON.stringify(manifest, null, 2).slice(0, 2000));
	console.log(`\n[dry-run] ${avatars.length} avatars -> ${MANIFEST_KEY} (not uploaded)`);
	process.exit(0);
}

const r2 = new S3Client({
	region: 'auto',
	endpoint: S3_ENDPOINT,
	credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});

await r2.send(new PutObjectCommand({
	Bucket: S3_BUCKET,
	Key: MANIFEST_KEY,
	Body: JSON.stringify(manifest),
	ContentType: 'application/json',
	CacheControl: 'public, max-age=300',
}));

console.log(`Published ${avatars.length} avatars -> ${S3_BUCKET}/${MANIFEST_KEY}`);
console.log('  served by GET /api/avatars/library');
