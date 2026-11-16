// Microsoft Marketplace emulator mode: the one switch that lets the SaaS offer
// code run against Microsoft's open-source SaaS Fulfillment API emulator
// (github.com/microsoft/Commercial-Marketplace-SaaS-API-Emulator) on a
// developer machine. scripts/microsoft-saas-e2e.mjs is its only caller.
//
// The emulator cannot mint Microsoft Entra tokens, so in this mode:
//   - webhook calls are accepted without the Entra bearer token, and
//   - the landing-page sign-in talks to MS_MARKETPLACE_EMULATOR_LOGIN_BASE
//     (authorize, token and signing keys) instead of login.microsoftonline.com.
//
// It is refused in any production runtime. server/index.mjs calls
// assertEmulatorModeAllowed() before it listens, so a revision deployed with
// the flag never takes traffic, and api/_lib/microsoft-marketplace.js checks
// again on every call. Kept free of imports so the server can run the check at
// boot without loading the database layer.

export const EMULATOR_FLAG = 'MS_MARKETPLACE_EMULATOR';
export const EMULATOR_LOGIN_BASE = 'MS_MARKETPLACE_EMULATOR_LOGIN_BASE';

export class EmulatorModeRefused extends Error {
	constructor(reason) {
		super(`${EMULATOR_FLAG}=1 is refused: ${reason}. Emulator mode accepts unsigned webhooks and is for local runs of scripts/microsoft-saas-e2e.mjs only.`);
		this.code = 'emulator_mode_refused';
	}
}

/** Why this environment counts as production, or null when it does not. */
export function productionReason(e = process.env) {
	if (e.NODE_ENV === 'production') return 'NODE_ENV is production';
	if (e.K_SERVICE) return `K_SERVICE is set (Cloud Run service ${e.K_SERVICE})`;
	if (e.VERCEL_ENV === 'production') return 'VERCEL_ENV is production';
	return null;
}

function requested(e) {
	return typeof e[EMULATOR_FLAG] === 'string' && e[EMULATOR_FLAG].trim() === '1';
}

/** Throw when emulator mode is requested in a production runtime; otherwise return whether it is on. */
export function assertEmulatorModeAllowed(e = process.env) {
	if (!requested(e)) return false;
	const reason = productionReason(e);
	if (reason) throw new EmulatorModeRefused(reason);
	return true;
}

/** Whether emulator mode is on. Throws EmulatorModeRefused in production rather than ever answering true there. */
export function emulatorMode(e = process.env) {
	return assertEmulatorModeAllowed(e);
}

/** The emulator-side stand-in for login.microsoftonline.com, only ever read in emulator mode. */
export function emulatorLoginBase(e = process.env) {
	if (!emulatorMode(e)) return null;
	const v = typeof e[EMULATOR_LOGIN_BASE] === 'string' ? e[EMULATOR_LOGIN_BASE].trim().replace(/\/+$/, '') : '';
	return v || null;
}
