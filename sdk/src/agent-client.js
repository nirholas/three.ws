/**
 * AgentClient — programmatic x402 payment support for skill invocation.
 */

export class PaymentRequiredError extends Error {
	/**
	 * @param {import('./index.d.ts').X402Manifest} manifest
	 */
	constructor(manifest) {
		super(`Skill requires payment: ${manifest.amount} ${manifest.currencySymbol}`);
		this.name = 'PaymentRequiredError';
		this.manifest = manifest;
	}
}

export class AgentClient {
	/**
	 * @param {object} opts
	 * @param {string} opts.baseUrl  Base URL of the 3D agent API (e.g. https://3d.irish)
	 */
	constructor({ baseUrl = '' } = {}) {
		this.baseUrl = baseUrl.replace(/\/$/, '');
	}

	/**
	 * Returns pricing info for all skills of an agent.
	 *
	 * @param {string} agentId
	 * @returns {Promise<import('./index.d.ts').SkillPrice[]>}
	 */
	async getSkillPrices(agentId) {
		const res = await fetch(`${this.baseUrl}/api/agents/${agentId}/pricing`);
		if (!res.ok) throw new Error(`getSkillPrices failed: ${res.status} ${res.statusText}`);
		return res.json();
	}

	/**
	 * Invoke a skill, handling x402 payment automatically when required.
	 *
	 * @param {string} agentId
	 * @param {string} skill
	 * @param {Record<string, unknown>} args
	 * @param {{ signer?: import('./index.d.ts').WalletSigner }} [options]
	 * @returns {Promise<import('./index.d.ts').SkillResult>}
	 */
	async invokeSkill(agentId, skill, args, options = {}) {
		const manifestRes = await fetch(`${this.baseUrl}/api/agents/${agentId}/x402/${skill}/manifest`);

		if (manifestRes.status === 404) {
			// Free skill — invoke directly
			return this._callSkill(agentId, skill, args, null);
		}

		if (!manifestRes.ok) {
			throw new Error(`Manifest fetch failed: ${manifestRes.status} ${manifestRes.statusText}`);
		}

		const manifest = await manifestRes.json();

		if (!options.signer) {
			throw new PaymentRequiredError(manifest);
		}

		const paymentProof = await options.signer.signPayment(manifest);
		return this._callSkill(agentId, skill, args, paymentProof);
	}

	/**
	 * @param {string} agentId
	 * @param {string} skill
	 * @param {Record<string, unknown>} args
	 * @param {string | null} paymentProof
	 * @returns {Promise<import('./index.d.ts').SkillResult>}
	 */
	async _callSkill(agentId, skill, args, paymentProof) {
		const headers = { 'Content-Type': 'application/json' };
		if (paymentProof) headers['X-Payment-Proof'] = paymentProof;

		const res = await fetch(`${this.baseUrl}/api/agents/${agentId}/skills/${skill}`, {
			method: 'POST',
			headers,
			body: JSON.stringify(args),
		});

		if (!res.ok) throw new Error(`Skill invocation failed: ${res.status} ${res.statusText}`);
		return res.json();
	}
}
