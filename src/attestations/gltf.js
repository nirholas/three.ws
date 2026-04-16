import { verifyMessage } from 'ethers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256Hex(blob) {
	const buf = await blob.arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Sorted-key, no-whitespace JSON — stable across environments. */
function canonicalJSON(obj) {
	if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return JSON.stringify(obj);
	const pairs = Object.keys(obj)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`);
	return `{${pairs.join(',')}}`;
}

/**
 * Canonical signing message:
 *   agent-3d:attestation:gltf:v1:{agentId}:{glbSha256}:{summaryHash}
 *
 * summaryHash = SHA-256(canonicalJSON(summary))
 * This binds the signature to the agentId, the exact GLB bytes, and the
 * validator summary — tampering with any of those breaks verification.
 */
async function buildMessage(agentId, glbSha256, summary) {
	const enc = new TextEncoder();
	const buf = enc.encode(canonicalJSON(summary));
	const digest = await crypto.subtle.digest('SHA-256', buf);
	const summaryHash = Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `agent-3d:attestation:gltf:v1:${agentId}:${glbSha256}:${summaryHash}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a signed glTF-validator attestation for a GLB file.
 *
 * The returned object can be stored as JSON alongside the GLB (e.g. in
 * attestations/gltf-validator.json) and referenced from the agent manifest's
 * `attestations` array.
 *
 * @param {object} opts
 * @param {Blob} opts.glbBlob              Raw GLB bytes
 * @param {object} opts.validatorReport    gltf-validator result object
 * @param {import('ethers').Signer} opts.signer  Wallet to sign with
 * @param {string} opts.agentId            Agent token ID (string)
 * @returns {Promise<object>}
 */
export async function createGlTFAttestation({ glbBlob, validatorReport, signer, agentId }) {
	const glbSha256 = await sha256Hex(glbBlob);
	const issuer = (await signer.getAddress()).toLowerCase();

	const summary = {
		errors: validatorReport?.issues?.numErrors ?? 0,
		warnings: validatorReport?.issues?.numWarnings ?? 0,
		severityMax: validatorReport?.issues?.maxSeverity ?? -1,
	};

	const message = await buildMessage(agentId, glbSha256, summary);
	const signature = await signer.signMessage(message);

	return {
		type: 'gltf-validator',
		spec: 'agent-3d:attestation:gltf:v1',
		agentId,
		glbSha256,
		summary,
		issuer,
		issuedAt: new Date().toISOString(),
		signature,
	};
}

/**
 * Verify a glTF-validator attestation against the original GLB blob.
 *
 * Pure-crypto — no wallet connection required.
 *
 * @param {object} opts
 * @param {object} opts.attestation       Parsed attestation JSON
 * @param {Blob} opts.glbBlob             GLB to verify against
 * @param {string[]} [opts.trustedIssuers] Optional allowlist of issuer addresses
 * @returns {Promise<{valid: boolean, issuer: string, reasons: string[]}>}
 */
export async function verifyGlTFAttestation({ attestation, glbBlob, trustedIssuers }) {
	const reasons = [];

	// 1. Recompute GLB hash — catches any byte-level tampering
	const glbSha256 = await sha256Hex(glbBlob);
	if (glbSha256 !== attestation.glbSha256) {
		reasons.push(`GLB hash mismatch: computed ${glbSha256}, attested ${attestation.glbSha256}`);
	}

	// 2. Recover signer from signature — catches any field tampering
	//    Note: we sign against the *attested* glbSha256 and summary so that
	//    the hash mismatch above is independent of signature failure.
	const message = await buildMessage(attestation.agentId, attestation.glbSha256, attestation.summary);
	let recoveredAddress;
	try {
		recoveredAddress = verifyMessage(message, attestation.signature).toLowerCase();
	} catch (e) {
		reasons.push(`Signature recovery failed: ${e.message}`);
		return { valid: false, issuer: attestation.issuer || '', reasons };
	}

	if (recoveredAddress !== attestation.issuer) {
		reasons.push(`Issuer mismatch: attested ${attestation.issuer}, recovered ${recoveredAddress}`);
	}

	// 3. Optional: enforce a caller-supplied trusted-issuer list
	if (trustedIssuers?.length) {
		const lower = trustedIssuers.map((a) => a.toLowerCase());
		if (!lower.includes(recoveredAddress)) {
			reasons.push(`Issuer ${recoveredAddress} is not in trustedIssuers`);
		}
	}

	return {
		valid: reasons.length === 0,
		issuer: recoveredAddress || attestation.issuer || '',
		reasons,
	};
}
