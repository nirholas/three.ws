// The last write of a Streamable HTTP POST on every three.ws MCP server.
//
// MCP 2025-06-18, Transports, "Sending Messages to the Server": when the POST
// body is only notifications or responses and the server accepts it, the
// server MUST answer 202 Accepted with no body. Anything that carried a request
// gets 200 with the JSON-RPC result: an object for a single message, an array
// for a batch. Dispatchers return null for a notification, so an empty
// `responses` list is exactly the "nothing to answer" case.

/**
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} body the parsed POST body (an array means a batch)
 * @param {object[]} responses the non-null dispatch results, in order
 */
export function sendRpcResponses(res, body, responses) {
	if (responses.length === 0) {
		res.statusCode = 202;
		res.removeHeader('content-type');
		res.end();
		return;
	}
	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify(Array.isArray(body) ? responses : responses[0]));
}
