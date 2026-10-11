// Typed errors for Event Markets. `status`, `code` and `detail` are the shape
// the v1 router (api/_lib/agents-v1/http.js) and the MCP tools both surface, so
// a refusal reads the same on REST and over MCP.

export class EventMarketError extends Error {
	/**
	 * @param {number} status HTTP status
	 * @param {string} code stable machine-readable code
	 * @param {string} message actionable sentence for the caller
	 * @param {object|null} [detail]
	 */
	constructor(status, code, message, detail = null) {
		super(message);
		this.name = 'EventMarketError';
		this.status = status;
		this.code = code;
		this.detail = detail;
	}
}
