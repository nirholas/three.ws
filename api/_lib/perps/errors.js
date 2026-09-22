// One error shape for the perps stack. Every boundary (the v1 router, the MCP
// tools, the wallet-intent executor) reads `status`, `code`, `message` and
// `detail` off it, so a guard refusal reaches a REST caller, a model and the
// owner's UI with the same stable code and the numbers behind the decision.

export class PerpsError extends Error {
	/**
	 * @param {number} status  HTTP-style status: 4xx is the caller's to fix, 5xx is ours or the venue's
	 * @param {string} code    stable machine-readable code (documented in docs/perps.md)
	 * @param {string} message plain-language explanation that says how to recover
	 * @param {object|null} [detail]
	 */
	constructor(status, code, message, detail = null) {
		super(message);
		this.name = 'PerpsError';
		this.status = status;
		this.code = code;
		this.detail = detail;
	}
}

export function perpsError(status, code, message, detail = null) {
	return new PerpsError(status, code, message, detail);
}
