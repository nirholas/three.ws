// S3-compatible storage client (works with AWS S3, Cloudflare R2, Backblaze B2, etc.)

import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

// Lazy client — S3Client constructor reads env credentials eagerly, so defer
// until first use to keep this module importable without storage configured.
let _r2;
function getR2() {
	if (!_r2) {
		_r2 = new S3Client({
			region: 'auto',
			endpoint: env.S3_ENDPOINT,
			credentials: {
				accessKeyId: env.S3_ACCESS_KEY_ID,
				secretAccessKey: env.S3_SECRET_ACCESS_KEY,
			},
			// AWS SDK v3 ≥ 3.730 adds CRC32 to every PutObject by default.
			// Browsers can't compute/send that header, so presigned PUT URLs
			// would be rejected by R2. Opt out until we add client-side CRC32.
			requestChecksumCalculation: 'WHEN_REQUIRED',
			responseChecksumValidation: 'WHEN_REQUIRED',
		});
	}
	return _r2;
}
export const r2 = new Proxy(
	{},
	{
		get(_t, prop) {
			return getR2()[prop];
		},
	},
);

// Short-lived signed URL for direct browser upload (PUT).
export async function presignUpload({ key, contentType, checksumSha256 }) {
	// Do NOT include ContentLength in the command — that adds content-length to
	// X-Amz-SignedHeaders, which browsers omit from CORS preflights (it is a
	// "forbidden" request header). R2 would then reject the preflight, causing
	// a network-level failure before the PUT response is ever checked.
	// Size is validated server-side via headObject after upload.
	const cmd = new PutObjectCommand({
		Bucket: env.S3_BUCKET,
		Key: key,
		ContentType: contentType,
		ChecksumSHA256: checksumSha256,
	});
	return getSignedUrl(r2, cmd, { expiresIn: 300 });
}

// Signed URL for GET (used for private avatars or temporary shares).
export async function presignGet({ key, expiresIn = 600 }) {
	const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
	return getSignedUrl(r2, cmd, { expiresIn });
}

export async function headObject(key) {
	try {
		return await r2.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
	} catch (err) {
		if (err?.$metadata?.httpStatusCode === 404) return null;
		throw err;
	}
}

export async function deleteObject(key) {
	await r2.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

export async function putObject({ key, body, contentType, metadata = {} }) {
	await r2.send(
		new PutObjectCommand({
			Bucket: env.S3_BUCKET,
			Key: key,
			Body: body,
			ContentType: contentType,
			Metadata: metadata,
		}),
	);
}

export async function getObjectBuffer(key) {
	const { Body } = await r2.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
	const chunks = [];
	for await (const chunk of Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks);
}

// Public CDN URL for objects served via R2 custom domain / r2.dev.
export function publicUrl(key) {
	return `${env.S3_PUBLIC_DOMAIN}/${encodeR2Key(key)}`;
}

function encodeR2Key(key) {
	return key.split('/').map(encodeURIComponent).join('/');
}
