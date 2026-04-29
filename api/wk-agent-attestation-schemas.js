// /.well-known/agent-attestation-schemas — three.ws Solana agent attestation schema registry.
//
// Machine-readable schemas for the SPL Memo-based ERC-8004 analog. Other agents
// and indexers consume this to validate payloads they discover via
// getSignaturesForAddress(<agent_asset>).

import { cors, json, method, wrap } from './_lib/http.js';

const COMMON = {
	v:     { type: 'integer', const: 1 },
	kind:  { type: 'string' },
	agent: { type: 'string', description: 'Metaplex Core asset pubkey (base58)' },
	ts:    { type: 'integer', description: 'Unix seconds when attestation was created' },
};

const SCHEMAS = {
	'threews.feedback.v1': {
		description: 'Client → agent feedback. Verified iff a matching task.accepted exists from this agent for the same task_id.',
		required: ['v', 'kind', 'agent', 'score'],
		properties: {
			...COMMON,
			score:   { type: 'integer', minimum: 1, maximum: 5 },
			task_id: { type: 'string' },
			uri:     { type: 'string', format: 'uri' },
		},
	},
	'threews.validation.v1': {
		description: 'Validator attestation about an agent task result.',
		required: ['v', 'kind', 'agent', 'task_hash', 'passed'],
		properties: {
			...COMMON,
			task_hash: { type: 'string' },
			passed:    { type: 'boolean' },
			uri:       { type: 'string', format: 'uri' },
		},
	},
	'threews.task.v1': {
		description: 'Client posts a task offer to an agent. Counterpart to task.accepted.',
		required: ['v', 'kind', 'agent', 'task_id', 'scope_hash'],
		properties: {
			...COMMON,
			task_id:    { type: 'string' },
			scope_hash: { type: 'string', description: 'Hash of off-chain task brief' },
			uri:        { type: 'string', format: 'uri' },
		},
	},
	'threews.accept.v1': {
		description: 'Agent accepts a task. Must be signed by the agent owner. Required for feedback to be verified.',
		required: ['v', 'kind', 'agent', 'task_id'],
		properties: {
			...COMMON,
			task_id: { type: 'string' },
		},
	},
	'threews.revoke.v1': {
		description: 'Revoke a previous attestation. Only honored when signed by the original attester.',
		required: ['v', 'kind', 'agent', 'target_signature'],
		properties: {
			...COMMON,
			target_signature: { type: 'string', description: 'Signature of the attestation being revoked' },
			reason:           { type: 'string' },
		},
	},
	'threews.dispute.v1': {
		description: 'Agent owner disputes a feedback or validation. Does not delete; flags disputed=true.',
		required: ['v', 'kind', 'agent', 'target_signature'],
		properties: {
			...COMMON,
			target_signature: { type: 'string' },
			reason:           { type: 'string' },
			uri:              { type: 'string', format: 'uri' },
		},
	},
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;
	return json(
		res,
		200,
		{
			version: 1,
			transport: {
				type: 'spl-memo',
				program: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
				note: 'Each attestation is a signed memo tx with the agent asset pubkey as a non-signer key.',
			},
			schemas: SCHEMAS,
			discovery: {
				list_endpoint: '/api/agents/solana-attestations?asset=<pubkey>&kind=...',
				reputation_endpoint: '/api/agents/solana-reputation?asset=<pubkey>',
			},
		},
		{ 'cache-control': 'public, max-age=300' },
	);
});
