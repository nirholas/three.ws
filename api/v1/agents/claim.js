// POST /api/v1/agents/claim: a signed-in human takes ownership of a self-signed
// agent with the one-time claim code its signup returned.
//
// Body: { code }. Requires a session or an API key holding `agents:write`.
// Effect: the agent moves to the caller's account, the agent's signup key is
// revoked, and the freeze and kill switch lift. The numeric spend and trade caps
// and the live-perps lock stay as they were until the owner raises them.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { claimSelfSignedAgent } from '../../_lib/agent-signup.js';

export default defineEndpoint({
	name: 'v1.agents.claim',
	method: 'POST',
	auth: 'required',
	scope: 'agents:write',
	handler: async ({ body, principal }) => {
		const code = typeof body?.code === 'string' ? body.code.trim() : '';
		if (!/^claim_[A-Za-z0-9_-]{20,64}$/.test(code)) fail(400, 'validation_error', 'code must be the claim code returned by signup');
		const result = await claimSelfSignedAgent({ claimCode: code, claimerId: principal.userId });
		return { agent_id: result.agentId, mode: 'claimed', caps: result.caps };
	},
});
