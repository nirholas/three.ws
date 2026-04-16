// S3-compatible storage client (works with AWS S3, Cloudflare R2, Backblaze B2, etc.)

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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
		});
	}
	return _r2;
}
export const r2 = new Proxy({}, {
	get(_t, prop) { return getR2()[prop]; },
});

// Short-lived signed URL for direct browser upload (PUT).
export async function presignUpload({ key, contentType, contentLength, checksumSha256 }) {
	const cmd = new PutObjectCommand({
		Bucket: env.S3_BUCKET,
		Key: key,
		ContentType: contentType,
		ContentLength: contentLength,
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

// Public CDN URL for objects served via R2 custom domain / r2.dev.
export function publicUrl(key) {
	return `${env.S3_PUBLIC_DOMAIN}/${encodeR2Key(key)}`;
}

function encodeR2Key(key) {
	return key.split('/').map(encodeURIComponent).join('/');
}
