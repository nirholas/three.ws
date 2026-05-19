// Shared X402Error type, kept in its own module so that the BSC direct-payment
// verifier (api/_lib/x402-bsc-direct.js) can throw it without creating an
// import cycle with x402-spec.js (which itself imports the verifier).
export class X402Error extends Error {
	constructor(code, message, status = 402) {
		super(message);
		this.code = code;
		this.status = status;
	}
}
