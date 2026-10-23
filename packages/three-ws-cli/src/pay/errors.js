// Stable exit codes and refusal reasons for `three-ws pay`. Scripts and agents
// branch on these, so a code or reason string never changes meaning once shipped.
// Permission refusals (10) always carry one of REASON as `error.reason`.

export const EXIT = Object.freeze({
	OK: 0,
	ERROR: 1,
	USAGE: 2,
	/** The challenge is outside the permissions file (see REASON for which rule). */
	PERMISSION_DENIED: 10,
	/** The amount is above `confirmAbove` and nobody was there to approve it. */
	CONFIRMATION_REQUIRED: 11,
	/** The server offered nothing this payer can settle (unknown scheme, non-Solana only). */
	NO_PAYABLE_OPTION: 12,
	/** The payment was sent and the server still answered 402. */
	PAYMENT_REJECTED: 13,
	/** No wallet, or it could not be unlocked. */
	WALLET_UNAVAILABLE: 14,
});

export const REASON = Object.freeze({
	permissionsMissing: 'permissions_missing',
	permissionsInvalid: 'permissions_invalid',
	originNotAllowed: 'origin_not_allowed',
	networkNotAllowed: 'network_not_allowed',
	assetNotAllowed: 'asset_not_allowed',
	payeeNotAllowed: 'payee_not_allowed',
	perCallLimit: 'per_call_limit',
	maxFlag: 'max_flag_exceeded',
	dailyLimit: 'daily_limit',
	confirmRequired: 'confirm_required',
	declined: 'declined_by_user',
	noPayableOption: 'no_payable_option',
	unsupportedIntent: 'unsupported_intent',
	expired: 'challenge_expired',
	paymentRejected: 'payment_rejected',
	walletMissing: 'wallet_missing',
	walletLocked: 'wallet_locked',
});

export class PayError extends Error {
	/**
	 * @param {number} exit one of EXIT
	 * @param {string} reason one of REASON (or a short snake_case code for EXIT.ERROR)
	 * @param {string} message what happened and how to fix it
	 * @param {object} [detail] machine-readable context for --json and MCP output
	 */
	constructor(exit, reason, message, detail = undefined) {
		super(message);
		this.name = 'PayError';
		this.exit = exit;
		this.reason = reason;
		this.code = reason;
		this.detail = detail;
	}
}

export function isPayError(err) {
	return err instanceof PayError;
}
