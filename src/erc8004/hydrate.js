/**
 * Client-side agent hydrator.
 * Fetches agents from /api/erc8004/hydrate and /api/erc8004/import.
 */

/**
 * Fetch discovered agents owned by the user's linked wallets.
 * @returns {Promise<Array<{ chainId, agentId, name, description, image, glbUrl, owner, alreadyImported }>>}
 */
export async function fetchDiscoveredAgents() {
	const res = await fetch('/api/erc8004/hydrate', {
		method: 'GET',
		credentials: 'include',
	});

	if (!res.ok) {
		const error = await res.json().catch(() => ({}));
		throw new Error(error.error_description || `HTTP ${res.status}`);
	}

	const data = await res.json();
	return data.agents || [];
}

/**
 * Import an on-chain agent.
 * @param {{ chainId: number, agentId: string }} agent
 * @returns {Promise<{ id, erc8004_agent_id, erc8004_agent_id_chain_id, name, avatar_url }>}
 */
export async function importAgent({ chainId, agentId }) {
	const res = await fetch('/api/erc8004/import', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chainId, agentId }),
	});

	if (!res.ok) {
		const error = await res.json().catch(() => ({}));
		throw new Error(error.error_description || `HTTP ${res.status}`);
	}

	const data = await res.json();
	return data.agent;
}
