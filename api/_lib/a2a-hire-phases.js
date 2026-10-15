// Pure phase → render mapping + cap math for the live agent-to-agent hire
// visualizer, plus the pure core of the fulfillment attestation every settled
// hire writes (api/_lib/trust/hire-attestations.js does the signing/DB I/O).
//
// /api/agents/a2a-hire emits ONE screen frame per real milestone of a hire so a
// viewer on /agent-screen watches the commerce happen end to end:
//
//   discover → quote → reserved → running → settled → delivered → recorded
//
// This module is the PURE part of that flow. Given a milestone and its real
// numbers it produces (a) the plain-language narration line + structured sidecar
// the client renders, and (b) the cap math that decides the over-cap verdict and
// the remaining daily headroom the badge shows. No I/O, no Redis, no clock — the
// caller stamps `ts` and writes the frame — so every branch here is exhaustively
// unit-testable, and the same builder runs on the server and in the test.

export const HIRE_KIND = 'a2a_hire';

// Ordered phases of a hire, in real timeline order. x402 settles only AFTER the
// provider's work succeeds (verify → work → settle), so `running` precedes
// `settled`: the coin animation fires on the real settled frame, never before.
// The client uses the index to drive its stepper and to drop stale/out-of-order
// frames on reconnect (it must never paint `settled` after it already showed the
// terminal receipt of a newer hire).
export const HIRE_PHASES = [
	'discover',
	'quote',
	'reserved',
	'running',
	'settled',
	'delivered',
	'recorded',
];
export const HIRE_PHASE_INDEX = Object.fromEntries(HIRE_PHASES.map((p, i) => [p, i]));

// Terminal non-happy phases — rendered as amber/red cards, not steps.
export const HIRE_ERROR_PHASES = ['over_cap', 'failed'];

const SOLSCAN_TX = 'https://solscan.io/tx/';

// Build a Solana explorer link from a real signature. Returns null for a missing
// signature so the client renders "pending" instead of a dead link.
export function explorerTxUrl(sig, network = 'mainnet') {
	if (!sig || typeof sig !== 'string') return null;
	const cluster = network === 'devnet' ? '?cluster=devnet' : '';
	return `${SOLSCAN_TX}${sig}${cluster}`;
}

// Round to USDC precision (6 decimals); null/undefined/non-finite → null (an
// absent limit means "no ceiling", and Number(null) === 0 would silently invent
// a zero cap that blocks every hire).
function money(n) {
	if (n == null) return null;
	const v = Number(n);
	if (!Number.isFinite(v)) return null;
	return Math.round(v * 1e6) / 1e6;
}

// Format a USD amount for narration. Whole-cent values read as $0.04; sub-cent
// micro-prices keep enough precision to not collapse to $0.00.
export function fmtUsd(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return '0.00';
	if (v !== 0 && Math.abs(v) < 0.01) return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
	return v.toFixed(2);
}

// Cap math: given the hire price and the hiring agent's real limits + prior
// rolling-24h spend, compute the over-cap verdict and the headroom the badge
// renders. A null limit means "no ceiling" (not zero); a null result field means
// "uncapped on that axis". `dailySpentUsd` is the spend BEFORE this hire.
export function hireCapMath({ usd, maxUsd = null, perTxUsd = null, dailyUsd = null, dailySpentUsd = 0 } = {}) {
	const EPS = 1e-9;
	const price = money(usd) ?? 0;
	const max = money(maxUsd);
	const perTx = money(perTxUsd);
	const daily = money(dailyUsd);
	const spent = money(dailySpentUsd) ?? 0;

	const overMax = max != null && price > max + EPS;
	const overPerTx = perTx != null && price > perTx + EPS;

	// Effective per-call ceiling shown on the badge = the tightest of the owner's
	// per-call maxUsd and the agent's policy per-tx limit.
	let perCallCap = null;
	if (max != null && perTx != null) perCallCap = Math.min(max, perTx);
	else if (max != null) perCallCap = max;
	else if (perTx != null) perCallCap = perTx;

	const dailyRemainingBefore = daily != null ? money(Math.max(0, daily - spent)) : null;
	const overDaily = daily != null && spent + price > daily + EPS;
	const dailyRemainingAfter = daily != null ? money(Math.max(0, daily - spent - price)) : null;

	return {
		price,
		overCap: overMax || overPerTx || overDaily,
		overMax,
		overPerTx,
		overDaily,
		perCallCap,
		dailyUsd: daily,
		dailySpentUsd: spent,
		dailyRemainingBefore,
		dailyRemainingAfter,
	};
}

function narration(phase, { skillLabel, provLabel, slug, price, cap, resultSummary, error }) {
	const capStr = cap?.perCallCap != null ? ` · cap $${fmtUsd(cap.perCallCap)}` : '';
	switch (phase) {
		case 'discover':
			return `Need ${skillLabel} — shopping the offer registry`;
		case 'quote':
			return `Quote: ${provLabel} · ${slug} · $${fmtUsd(price)} USDC${capStr}`;
		case 'reserved':
			return `Spend reserved within caps — hiring ${provLabel}`;
		case 'running':
			return `Running remote skill: ${slug}`;
		case 'settled':
			return `Settled $${fmtUsd(price)} USDC to ${provLabel}`;
		case 'delivered':
			return `${provLabel} delivered ${skillLabel}${resultSummary ? ` — ${resultSummary}` : ''}`;
		case 'recorded':
			return 'On-chain invocation receipt recorded';
		case 'over_cap':
			return `Skipped: $${fmtUsd(price)} would exceed the cap${cap?.perCallCap != null ? ` of $${fmtUsd(cap.perCallCap)}` : ''}`;
		case 'failed':
			return error
				? `Skill failed — no charge (verify-then-settle): ${error}`
				: 'Skill failed — no charge (verify-then-settle)';
		default:
			return `Hire: ${phase}`;
	}
}

// Map a real hire milestone to a screen frame the client renders: a plain
// narration line, the `analysis` frame type, and a structured `meta` sidecar that
// carries everything the visualizer needs (price, cap, signatures, explorer
// links). Pure and synchronous — the caller stamps `ts` and writes it.
export function hirePhaseFrame(phase, ctx = {}) {
	const {
		hireId = null,
		slug = null,
		skill = null,
		providerName = null,
		providerId = null,
		hirerId = null,
		hirerName = null,
		usd,
		maxUsd = null,
		network = 'mainnet',
		cap = null,
		txSig = null,
		invocationSig = null,
		resultSummary = null,
		error = null,
	} = ctx;

	const price = money(usd);
	const skillLabel = skill || slug || 'a skill';
	const provLabel = providerName || 'a provider';
	const ok = !HIRE_ERROR_PHASES.includes(phase);

	const meta = {
		kind: HIRE_KIND,
		phase,
		phaseIndex: phase in HIRE_PHASE_INDEX ? HIRE_PHASE_INDEX[phase] : -1,
		ok,
		hireId,
		slug,
		skill,
		providerName,
		providerId,
		hirerId,
		hirerName,
		usd: price,
		maxUsd: money(maxUsd),
		cap: cap || null,
		network,
		txSig: txSig || null,
		paymentExplorer: explorerTxUrl(txSig, network),
		invocationSig: invocationSig || null,
		invocationExplorer: explorerTxUrl(invocationSig, network),
		resultSummary: resultSummary || null,
		error: error || null,
	};

	const activity = narration(phase, { skillLabel, provLabel, slug, price, cap, resultSummary, error });
	return { activity, type: 'analysis', meta };
}

// ── Fulfillment attestation (pure core) ──────────────────────────────────────
//
// Every settled hire gets exactly one attestation row:
//   { hire_id, payment_signature, outcome, evidence_hash, signed_by }
// outcome is one of delivered | failed | disputed. The 'recorded' phase is the
// only path to 'delivered': a thrown payment error is 'failed' UNLESS the
// error itself is ambiguous (e.g. a client timeout that fired after the
// provider may have already settled server-side, since x402 settle happens
// upstream of the response reaching us), in which case it is 'disputed'.
// Never infer 'delivered' from an ambiguous error.

// A client-side timeout/abort tells us nothing about whether the x402
// endpoint's verify-then-settle already completed server-side before the
// response was lost, so it is the one failure shape that is genuinely
// ambiguous rather than a clean "no funds moved".
export function isAmbiguousPaymentError(err) {
	if (!err) return false;
	const code = err.code || err.cause?.code || '';
	const name = err.name || '';
	const msg = String(err.message || '').toLowerCase();
	return (
		code === 'ECONNABORTED' ||
		code === 'ETIMEDOUT' ||
		code === 'ERR_CANCELED' ||
		name === 'CanceledError' ||
		msg.includes('timeout') ||
		msg.includes('timed out')
	);
}

// phase is the terminal hire-visualizer phase ('recorded' for a completed
// hire, 'failed' for a thrown payment/reservation error).
export function classifyHireOutcome(phase, err = null) {
	if (phase === 'recorded') return 'delivered';
	if (isAmbiguousPaymentError(err)) return 'disputed';
	return 'failed';
}

// Deterministic, key-order-independent JSON so the same evidence always
// hashes the same regardless of how the caller built the object. Exported so
// api/_lib/trust/hire-attestations.js (server-only) can sha256 it for
// hireEvidenceHash without this shared client+server module importing
// node:crypto.
export function sortedStringify(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(sortedStringify).join(',')}]`;
	const keys = Object.keys(value).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(value[k])}`).join(',')}}`;
}

// Canonical attestation payload shape, independent of signing.
export function buildHireAttestationPayload({ hireId, paymentSignature, outcome, evidenceHash, signedBy }) {
	return {
		hire_id: hireId,
		payment_signature: paymentSignature || null,
		outcome,
		evidence_hash: evidenceHash,
		signed_by: signedBy,
	};
}
