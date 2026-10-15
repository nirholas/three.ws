// Signed hire fulfillment attestations: on every settled a2a-hire (success or
// failure), write ONE row recording whether the provider delivered. Signed
// off-chain with the same platform attestation key api/_lib/attest-event.js
// uses for on-chain provenance memos (ATTEST_AGENT_SECRET_KEY), reused for
// the keypair only; this module never builds or sends a Solana transaction.
//
// This is the real-data source behind the agent reputation score's
// fulfillment-rate pillar (src/shared/agent-financial-reputation.js) and the
// optional x402 pricing discount (hire-discount.js).

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { sql } from '../db.js';
import { loadAttesterKeypair } from '../attest-event.js';
import { classifyHireOutcome, buildHireAttestationPayload, sortedStringify } from '../a2a-hire-phases.js';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');

export { classifyHireOutcome };

function hireEvidenceHash(facts = {}) {
	return createHash('sha256').update(sortedStringify(facts)).digest('hex');
}

// Sign a complete attestation payload (signed_by already filled in) with the
// platform attester key. Returns the base64 signature.
function signPayload(payload) {
	const keypair = loadAttesterKeypair();
	const message = Buffer.from(sortedStringify(payload), 'utf8');
	const signature = nacl.sign.detached(message, keypair.secretKey);
	return Buffer.from(signature).toString('base64');
}

// Verify a previously-signed attestation against the CURRENT platform
// attester key. Returns true/false; never throws on a malformed input.
export function verifyHireAttestation({ payload, signature, signedBy }) {
	try {
		const keypair = loadAttesterKeypair();
		if (signedBy && signedBy !== keypair.publicKey.toBase58()) return false;
		const message = Buffer.from(sortedStringify(payload), 'utf8');
		return nacl.sign.detached.verify(
			message,
			Buffer.from(signature, 'base64'),
			keypair.publicKey.toBuffer(),
		);
	} catch {
		return false;
	}
}

// Build the evidence facts for a hire from the real, already-settled row,
// never from caller input, so the hash can't be forged to match a different
// outcome than what actually happened.
function evidenceFacts(hireRow, { paymentSignature, invocationSignature, resultSummary, errorMessage } = {}) {
	return {
		hire_id: hireRow.id,
		hirer_agent_id: hireRow.hirer_agent_id ?? hireRow.hirerAgentId ?? null,
		provider_agent_id: hireRow.provider_agent_id ?? hireRow.providerAgentId ?? null,
		service_slug: hireRow.service_slug ?? hireRow.serviceSlug ?? null,
		usd: hireRow.usd ?? null,
		payment_signature: paymentSignature ?? hireRow.payment_signature ?? null,
		invocation_signature: invocationSignature ?? hireRow.invocation_signature ?? null,
		result_summary: resultSummary ?? null,
		error: errorMessage ?? null,
	};
}

// Record one attestation for a settled hire. `phase` is the hire-visualizer
// terminal phase ('recorded' for completed, 'failed' for a thrown payment
// error); `err` is the thrown error object when phase is 'failed' (used only
// to detect an ambiguous timeout, per classifyHireOutcome, never to infer
// 'delivered'). Idempotent: a retried terminal write for the same hire_id is a
// no-op (unique constraint), since a hire's terminal status never changes
// twice.
export async function recordHireAttestation(hireRow, { phase, err = null, paymentSignature = null, invocationSignature = null, resultSummary = null } = {}) {
	const outcome = classifyHireOutcome(phase, err);
	const facts = evidenceFacts(hireRow, {
		paymentSignature,
		invocationSignature,
		resultSummary,
		errorMessage: err?.message || null,
	});
	const evidenceHash = hireEvidenceHash(facts);
	let keypair;
	try {
		keypair = loadAttesterKeypair();
	} catch (keyErr) {
		console.error('[hire-attestations] attester key unavailable', keyErr?.message || keyErr);
		return null;
	}
	const payload = buildHireAttestationPayload({
		hireId: hireRow.id,
		paymentSignature: paymentSignature ?? hireRow.payment_signature ?? null,
		outcome,
		evidenceHash,
		signedBy: keypair.publicKey.toBase58(),
	});
	const signature = signPayload(payload);
	try {
		const [row] = await sql`
			INSERT INTO hire_attestations
				(hire_id, payment_signature, outcome, evidence_hash, signed_by, signature, payload)
			VALUES (
				${hireRow.id}, ${payload.payment_signature}, ${outcome}, ${evidenceHash},
				${payload.signed_by}, ${signature}, ${JSON.stringify(payload)}::jsonb
			)
			ON CONFLICT (hire_id) DO NOTHING
			RETURNING id, hire_id, outcome, evidence_hash, signed_by, signature, created_at
		`;
		return row || null;
	} catch (dbErr) {
		console.error('[hire-attestations] insert failed', dbErr?.message || dbErr);
		return null;
	}
}

// Recency-weighted fulfillment rate: each attestation's contribution decays
// with age (half-life `halfLifeDays`), so a provider's recent conduct matters
// more than a clean record from a year ago. 'disputed' never counts toward
// delivery: an unresolved hire is a risk signal, not a null result.
export function weightedFulfillmentRate(records, { halfLifeDays = 30, now = Date.now() } = {}) {
	let weightSum = 0;
	let deliveredWeightSum = 0;
	for (const r of records) {
		const createdAt = r.created_at instanceof Date ? r.created_at.getTime() : new Date(r.created_at).getTime();
		const ageDays = Math.max(0, (now - createdAt) / 86_400_000);
		const w = Math.pow(0.5, ageDays / halfLifeDays);
		weightSum += w;
		if (r.outcome === 'delivered') deliveredWeightSum += w;
	}
	return {
		rate: weightSum > 0 ? deliveredWeightSum / weightSum : null,
		sampleSize: records.length,
		weightedSampleSize: weightSum,
	};
}

// Real-data read: a provider agent's fulfillment rate from its own
// attestation history. Gated by `minSample`: below it, `rate` is null and
// the caller must not let fulfillment move the reputation score (there isn't
// enough signal yet, which is itself informative but not a penalty).
export async function computeFulfillmentRate(agentId, { halfLifeDays = 30, minSample = 5, limit = 500, now = Date.now() } = {}) {
	if (!agentId) return { rate: null, sampleSize: 0, weightedSampleSize: 0, meetsMinimum: false, minSample };
	const rows = await sql`
		SELECT ha.outcome, ha.created_at
		FROM hire_attestations ha
		JOIN agent_hires ah ON ah.id = ha.hire_id
		WHERE ah.provider_agent_id = ${agentId}
		ORDER BY ha.created_at DESC
		LIMIT ${limit}
	`;
	const { rate, sampleSize, weightedSampleSize } = weightedFulfillmentRate(rows, { halfLifeDays, now });
	const meetsMinimum = sampleSize >= minSample;
	return { rate: meetsMinimum ? rate : null, sampleSize, weightedSampleSize, meetsMinimum, minSample };
}
