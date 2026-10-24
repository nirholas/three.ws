// The metered router's price table, as data.
//
// One row per model id POST /api/v1/chat/completions serves. The per-million
// prices come from the published inference rate in ./catalog.js, so the keyed
// credits path and the pay-per-request path charge the same amount for the
// same tokens and /api/v1/models never drifts from what is billed. The other
// fields bound a single request so the x402 `upto` challenge can be sized to
// the model's worst case before any work runs:
//
//   max_rounds                 model rounds one request may run. The agent loop
//                              is capped at MAX_TOOL_ROUNDS tool rounds plus the
//                              answering round (api/agent/run.js).
//   max_output_tokens_round    completion tokens one round may emit.
//   context_allowance_round    tokens of tool output and loop history one round
//                              may add to its prompt on top of the caller's.
//   client_tools_max_output    ceiling for a request that brings its own `tools`
//                              (one round, api/_lib/client-tool-round.js).

import { INFERENCE_USD_PER_MTOK, INFERENCE_MIN_CALL_USD } from './catalog.js';

export const INFERENCE_MODEL_ROWS = Object.freeze([
	Object.freeze({
		id: 'three-ws/agent',
		aliases: Object.freeze(['three-ws', 'default']),
		input_usd_per_mtok: INFERENCE_USD_PER_MTOK.input,
		output_usd_per_mtok: INFERENCE_USD_PER_MTOK.output,
		min_call_usd: INFERENCE_MIN_CALL_USD,
		max_rounds: 5,
		max_output_tokens_round: 1024,
		context_allowance_round: 16_000,
		client_tools_max_output: 8192,
	}),
]);

/** The row for a model id or alias, or null when the model is not served. */
export function inferenceModelRow(id) {
	const wanted = String(id || '').trim();
	if (!wanted) return INFERENCE_MODEL_ROWS[0];
	return INFERENCE_MODEL_ROWS.find((r) => r.id === wanted || r.aliases.includes(wanted)) || null;
}
