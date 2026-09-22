// Durable hosting for gateway outputs (screenshots, audio, video).
//
// Outputs are written to the platform bucket under the caller's own prefix and
// returned as a public CDN URL, so a model or a client can hand the link to a
// person. When object storage rejects the write (a credential or endpoint
// fault, not a programming error) a small output is returned inline as a data
// URI instead, so a storage outage costs a durable copy, never the result.

import { randomUUID } from 'node:crypto';
import { putObject, publicUrl, isStorageInfrastructureError } from '../r2.js';

const INLINE_FALLBACK_MAX_BYTES = 1_500_000;

/**
 * @param {object} o
 * @param {string} o.userId
 * @param {'screenshots'|'audio'|'video'} o.kind
 * @param {Buffer} o.body
 * @param {string} o.contentType
 * @param {string} o.ext
 * @returns {Promise<{ url: string, key: string|null, inline: boolean, bytes: number }>}
 */
export async function persistGatewayOutput({ userId, kind, body, contentType, ext }) {
	const key = `gateway/${userId}/${kind}/${randomUUID()}.${ext}`;
	try {
		await putObject({ key, body, contentType, metadata: { source: 'tool-gateway' } });
		return { url: publicUrl(key), key, inline: false, bytes: body.length };
	} catch (err) {
		if (!isStorageInfrastructureError(err) || body.length > INLINE_FALLBACK_MAX_BYTES) throw err;
		console.warn(`[tool-gateway] object storage rejected a ${kind} output (${err?.name || 'storage error'}); returning it inline`);
		return { url: `data:${contentType};base64,${body.toString('base64')}`, key: null, inline: true, bytes: body.length };
	}
}
