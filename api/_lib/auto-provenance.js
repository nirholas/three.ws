// Automatic, free content credentials: the "by default" half of
// specs/PROVENANCE_3D.md. Before this module existed, a signed credential only
// came into being when an agent explicitly (and separately) paid for
// anchor_provenance (api/_mcp3d/tools/provenance.js). Every other GLB this
// platform delivered carried no credential at all: `verify_provenance` and
// GET /api/provenance answered `unknown` for it, forever, unless someone later
// anchored it by hand.
//
// This module signs and stores that SAME envelope shape automatically, for
// free, at the moment a GLB is finalized or served. No on-chain write, so no
// irreversible spend happens unattended (CLAUDE.md gate 1). Anchoring on
// Solana stays a separate, explicit, paid upgrade: decideVerdict
// (provenance-3d.js) already returns `verified` from the signature alone, so
// the free credential issued here is a complete, real, publicly verifiable
// authenticity record on its own; the paid anchor only adds an on-chain
// confirmation link on top of it.
//
// Best-effort and idempotent, the same contract as writeAssetProvenance
// (asset-provenance.js) and gradeDeliveredMesh (forge-store.js): a signing or
// storage failure here never blocks delivery of the asset it accompanies, and
// a GLB whose hash already has an envelope (auto-issued or anchored) is left
// alone: a credential is evidence, and evidence is not reissued.
//
// The owner is the only opt-out (work order 079): set PROVENANCE_AUTO_DISABLE
// to "true" on the deployment to turn this off everywhere it's called. No
// per-request or per-caller flag exists, by design: a credential records
// what three.ws produced, not a preference the caller gets to toggle.

import { headObject, putObject } from './r2.js';
import { decodeAttesterSecret } from './attest-event.js';
import { fetchSafePublicUrl } from './ssrf-guard.js';
import { sha256Hex, buildCredential, signCredential, credentialHash, provenanceKey } from './provenance-3d.js';

const MAX_GLB_BYTES = 64 * 1024 * 1024; // matches the MCP provenance tools' ceiling

export function autoProvenanceDisabled() {
	return process.env.PROVENANCE_AUTO_DISABLE === 'true';
}

/**
 * Sign and store a free (unanchored) content credential for a GLB already in
 * memory. Never throws.
 *
 * @returns {Promise<object|null>} the envelope written, or null when skipped
 *   (owner opt-out, no issuer key configured, a credential already exists for
 *   these exact bytes, or a signing/storage failure, logged, never thrown).
 */
export async function autoCredentialForBytes({
	buffer,
	assetId,
	creator,
	prompt,
	model,
	provider,
	lineage,
} = {}) {
	if (autoProvenanceDisabled()) return null;
	if (!buffer?.length) return null;

	const secret = decodeAttesterSecret(process.env.ATTEST_AGENT_SECRET_KEY || '');
	if (!secret) return null; // no issuer key on this deployment: an honest no-op, not a fake credential.

	const glbSha256 = sha256Hex(buffer);
	const key = provenanceKey(glbSha256);

	try {
		const existing = await headObject(key);
		if (existing) return null; // these exact bytes already carry a credential (auto or anchored).
	} catch (err) {
		console.warn('[auto-provenance] existence check failed, attempting to credential anyway:', err?.message);
	}

	let credential;
	try {
		credential = buildCredential({
			glbSha256,
			createdAt: new Date().toISOString(),
			assetId,
			creator,
			prompt,
			model,
			provider,
			lineage,
		});
	} catch (err) {
		console.warn('[auto-provenance] credential build failed:', err?.message);
		return null;
	}

	const { signature, issuer } = signCredential(credential, secret);
	const envelope = { credential, signature, issuer, credentialHash: credentialHash(credential) };

	try {
		await putObject({
			key,
			body: Buffer.from(JSON.stringify(envelope), 'utf8'),
			contentType: 'application/json',
		});
		return envelope;
	} catch (err) {
		console.warn('[auto-provenance] credential store failed:', err?.message);
		return null;
	}
}

/**
 * Same as autoCredentialForBytes, but for a known https GLB URL instead of
 * bytes already in hand (an export/download endpoint ensuring the asset it is
 * about to serve carries a credential). SSRF-guarded fetch, same ceiling as
 * the anchor/verify MCP tools. Never throws.
 */
export async function ensureAutoCredential({ glbUrl, assetId, creator, prompt, model, provider, lineage } = {}) {
	if (autoProvenanceDisabled()) return null;
	if (!/^https:\/\//i.test(String(glbUrl || ''))) return null;
	try {
		const res = await fetchSafePublicUrl(glbUrl, { redirect: 'follow' }, { maxBytes: MAX_GLB_BYTES });
		if (!res.ok) return null;
		const buffer = Buffer.from(await res.arrayBuffer());
		return await autoCredentialForBytes({ buffer, assetId, creator, prompt, model, provider, lineage });
	} catch (err) {
		console.warn('[auto-provenance] ensure-by-url failed:', err?.message);
		return null;
	}
}
