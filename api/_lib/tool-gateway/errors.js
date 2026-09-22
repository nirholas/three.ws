// The typed error every gateway tool throws. `status` and `code` map straight
// onto an HTTP response (the REST route), an MCP tool error (the MCP server) and
// a tool-result error (the agent loop), so all three surfaces say the same thing.

export class GatewayError extends Error {
	/**
	 * @param {number} status
	 * @param {string} code
	 * @param {string} message
	 * @param {object|null} [details]
	 */
	constructor(status, code, message, details = null) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
		this.detail = details;
		this.expose = true;
	}
}
