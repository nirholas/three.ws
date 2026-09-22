// The one error type every lending layer throws. `status` is the HTTP status a
// boundary should answer with; `code` is the stable machine-readable reason
// documented in docs/lending.md; `detail` carries the numbers behind a refusal.

export class LendingError extends Error {
	constructor(code, message, status = 400, detail = null) {
		super(message);
		this.name = 'LendingError';
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
}
