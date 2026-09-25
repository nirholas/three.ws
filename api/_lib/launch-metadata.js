// Coin metadata pinning, shared by every launch surface.
//
// The launch page (POST /api/pump/build-metadata), the agent launch service
// (api/_lib/launch-service.js) and the MCP launch tools all publish a coin's
// image and metadata JSON the same way: IPFS first through the configured
// pinning chain, the R2 bucket when no pinning provider answers, and the
// canonical three.ws brand builder for the JSON itself so explorers and
// aggregators read the same attribution whichever surface launched the coin.

import { putObject, publicUrl as r2PublicUrl } from './r2.js';
import { pinToIPFS, ipfsPinningConfigured } from './ipfs-pin.js';
import { buildTokenMetadata } from './three-brand.js';
import { fetchSafePublicUrl } from './ssrf-guard.js';

export const LAUNCH_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;

export class LaunchMetadataError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

function extFor(contentType) {
	const t = String(contentType || '').toLowerCase();
	if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
	if (t.includes('gif')) return 'gif';
	if (t.includes('webp')) return 'webp';
	return 'png';
}

/**
 * Decode a `data:image/...;base64,` URL into bytes. Pure.
 * @returns {{ buf: Buffer, contentType: string }}
 */
export function decodeImageDataUrl(dataUrl) {
	const comma = String(dataUrl || '').indexOf(',');
	if (comma === -1) throw new LaunchMetadataError(400, 'validation_error', 'invalid image_data_url');
	const head = dataUrl.slice(0, comma);
	const payload = dataUrl.slice(comma + 1);
	const buf = head.includes('base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
	if (buf.byteLength > LAUNCH_IMAGE_MAX_BYTES) throw new LaunchMetadataError(413, 'payload_too_large', 'image must be under 4 MB');
	return { buf, contentType: head.match(/data:([^;,]+)/)?.[1] || 'image/png' };
}

/**
 * Download a public https image for pinning. SSRF-guarded (every redirect hop
 * is re-checked), bounded in size, and refused unless it is really an image.
 * @returns {Promise<{ buf: Buffer, contentType: string }>}
 */
export async function fetchLaunchImage(url) {
	let res;
	try {
		res = await fetchSafePublicUrl(url, { signal: AbortSignal.timeout(15_000) });
	} catch (err) {
		throw new LaunchMetadataError(400, 'image_unreachable', `The image URL could not be fetched: ${err?.message || err}`);
	}
	if (!res.ok) throw new LaunchMetadataError(400, 'image_unreachable', `The image URL answered ${res.status}`);
	const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
	if (!IMAGE_TYPES.test(contentType)) {
		throw new LaunchMetadataError(400, 'not_an_image', 'The image URL must serve a PNG, JPG, GIF or WebP image');
	}
	const declared = Number(res.headers.get('content-length'));
	if (declared > LAUNCH_IMAGE_MAX_BYTES) throw new LaunchMetadataError(413, 'payload_too_large', 'image must be under 4 MB');
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength > LAUNCH_IMAGE_MAX_BYTES) throw new LaunchMetadataError(413, 'payload_too_large', 'image must be under 4 MB');
	return { buf, contentType };
}

/** Pin image bytes: IPFS first, R2 when no pinning provider answers. */
export async function pinLaunchImage({ buf, contentType, prefix }) {
	const ext = extFor(contentType);
	const pinned = await pinToIPFS(buf, `image.${ext}`).catch(() => null);
	if (pinned) return { url: pinned.uri, on_ipfs: true };
	const key = `${prefix}/image.${ext}`;
	await putObject({ key, body: buf, contentType });
	return { url: r2PublicUrl(key), on_ipfs: false };
}

/**
 * Build and pin a coin's metadata JSON through the brand builder.
 * @param {object} o
 * @param {string} o.prefix         R2 key prefix for the fallback copy
 * @param {string} o.name
 * @param {string} o.symbol
 * @param {string} [o.description]
 * @param {string} o.imageUrl       already-pinned image URL
 * @param {string} [o.agentUrl]
 * @param {string} [o.agentModelUrl]
 * @param {{ twitter?: string, website?: string, telegram?: string }} [o.links]
 */
export async function pinLaunchMetadata({ prefix, name, symbol, description = '', imageUrl, agentUrl, agentModelUrl, links = {} }) {
	const metadata = buildTokenMetadata({
		name,
		symbol,
		description,
		image: imageUrl || '',
		...(agentUrl ? { agentUrl } : {}),
		...(agentModelUrl ? { agentModelUrl } : {}),
		...(links.twitter ? { twitter: links.twitter } : {}),
		...(links.website ? { website: links.website } : {}),
		...(links.telegram ? { telegram: links.telegram } : {}),
		createdAt: new Date().toISOString(),
	});
	const jsonBuf = Buffer.from(JSON.stringify(metadata, null, 2));
	const pinned = await pinToIPFS(jsonBuf, 'metadata.json').catch(() => null);
	if (pinned) return { metadata_url: pinned.uri, on_ipfs: true, provider: pinned.provider };
	const key = `${prefix}/metadata.json`;
	await putObject({ key, body: jsonBuf, contentType: 'application/json' });
	return { metadata_url: r2PublicUrl(key), on_ipfs: false, provider: ipfsPinningConfigured() ? 'r2-fallback' : 'r2' };
}

/** The R2 prefix a user's launch metadata lives under. */
export function launchMetadataPrefix(userId) {
	return `pump/meta/${userId}/${Date.now().toString(36)}`;
}
