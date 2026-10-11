/**
 * risk-ack — bundler-side wrapper around the canonical /risk-ack.js module.
 *
 * The implementation lives in public/risk-ack.js so plain public/ scripts and
 * third-party embeds (x402.js on merchant sites) can import it at runtime from
 * the three.ws origin. App code imports THIS wrapper; the @vite-ignore dynamic
 * import defers resolution to the browser, where /risk-ack.js is served from
 * the public root in both dev and production.
 *
 * Gate every money-committing action:
 *
 *   import { ensureRiskAck } from '../shared/risk-ack.js';
 *   if (!(await ensureRiskAck({ context: 'trade' }))) return; // user declined
 *
 * Failure policy: this wrapper NEVER rejects. Money features must not brick
 * because the acknowledgment machinery had a bad day. If /risk-ack.js cannot
 * be loaded (broken deploy, blocked request), the gate degrades to a native
 * confirm() carrying the core acceptance text — the user is still asked, the
 * feature still works. The degraded acceptance is remembered only for this
 * page session (no version constant to trust without the module).
 */

// Fallback origin for a non-browser context. The wrapper is client-only, but a
// module-level evaluation under SSR must not throw on a missing `location`.
const THREE_WS_ORIGIN = 'https://three.ws';

function _mod() {
	// Resolve at runtime from the serving origin (public/risk-ack.js). The
	// specifier has to stay non-analyzable in TWO passes, not one: Rollup
	// resolves a string literal even with @vite-ignore and fails our build, and
	// a local `const spec = '/risk-ack.js'` gets constant-folded straight back
	// into `import("/risk-ack.js")` in the emitted bundle, which then breaks any
	// downstream bundler that re-processes the published @three-ws/avatar
	// artifact (rolldown, rollup, and webpack all fail to resolve a
	// root-absolute path). Building the URL from the live origin is an
	// expression no optimizer can fold, so both passes leave it alone and the
	// browser does the resolving, which is the deferral this wrapper documents.
	const origin = globalThis.location?.origin || THREE_WS_ORIGIN;
	return import(/* @vite-ignore */ `${origin}/risk-ack.js`);
}

// Same core wording as RISK_ACK_CONFIRM_TEXT in public/risk-ack.js, inlined
// because this path only runs when that module failed to load. It records
// nothing server-side (the module that records is the one that failed), so a
// signed-in account is still refused by the server until it signs through the
// real dialog; the degraded confirm only keeps anonymous flows usable.
const DEGRADED_CONFIRM_TEXT =
	'Real funds: sign the agreements\n\n' +
	'three.ws is experimental technology. By pressing OK you agree to the Terms of Service (three.ws/legal/tos), ' +
	'the Risk Disclosure (three.ws/legal/risk), and the Agent Wallet Agreement (three.ws/legal/agent-wallet). ' +
	'You confirm you are 18 or older and that real-funds use is lawful where you live. You accept that anything ' +
	'you deposit, trade, or send can be lost completely for any reason, nothing is insured, and three.ws is not ' +
	'responsible for any loss.\n\n' +
	'Press OK to accept, or Cancel to stop.';

let _degradedSessionAck = false;

function _degradedConfirm() {
	if (_degradedSessionAck) return true;
	try {
		_degradedSessionAck = globalThis.confirm?.(DEGRADED_CONFIRM_TEXT) === true;
	} catch {
		_degradedSessionAck = false;
	}
	return _degradedSessionAck;
}

/**
 * Ensure the user has signed the current real-funds agreements, showing the
 * signing dialog if not. Resolves true when signed, false when declined; the
 * caller must abort the money action on false. Never rejects.
 * @param {{context?: string, force?: boolean}} [opts]
 * @returns {Promise<boolean>}
 */
export async function ensureRiskAck(opts) {
	// Checked here as well as in public/risk-ack.js so the degraded confirm()
	// path below cannot run a payment inside the iOS app either.
	if (globalThis.threeWsNative?.requireSafari?.(undefined, { context: opts?.context ?? 'real-funds' }) === true) return false;
	let m;
	try {
		m = await _mod();
	} catch (err) {
		console.error('[risk-ack] module failed to load, degrading to confirm()', err);
		return _degradedConfirm();
	}
	try {
		return await m.ensureRiskAck(opts);
	} catch (err) {
		console.error('[risk-ack] gate failed, degrading to confirm()', err);
		return _degradedConfirm();
	}
}

/** @returns {Promise<boolean>} whether this browser holds a current signature. Never rejects. */
export async function hasRiskAck() {
	try {
		const m = await _mod();
		return m.hasRiskAck();
	} catch {
		return _degradedSessionAck;
	}
}

/**
 * Whether the visitor has signed, confirming the account's server record when
 * signed in. Never prompts, never rejects.
 * @returns {Promise<boolean>}
 */
export async function hasRiskAckVerified() {
	try {
		const m = await _mod();
		return await m.hasRiskAckVerified();
	} catch {
		return _degradedSessionAck;
	}
}

/**
 * fetch() that opens the signing dialog when the server answers 403
 * risk_ack_required, then retries once after the user signs. When the gate
 * module cannot load, the original response is returned untouched so the
 * caller's normal error handling shows the server's message.
 * @param {RequestInfo|URL} input
 * @param {RequestInit} [init]
 * @param {{context?: string}} [opts]
 * @returns {Promise<Response>}
 */
export async function fetchWithRiskAck(input, init, opts) {
	let m;
	try {
		m = await _mod();
	} catch {
		return fetch(input, init);
	}
	return m.fetchWithRiskAck(input, init, opts);
}
