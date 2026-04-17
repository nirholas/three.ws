/**
 * .well-known manifest generators for ERC-8004 agents.
 *
 * Call these to get the JSON objects, then serve them from your server at:
 *   /.well-known/agent-registration.json
 *   /.well-known/agent-card.json
 *   /.well-known/ai-plugin.json
 */

/**
 * Generate an ERC-8004 agent-registration.json document.
 *
 * @param {object} opts
 * @param {string}   opts.name         Agent display name
 * @param {string}   opts.description  What the agent does
 * @param {string}   opts.endpoint     Primary web endpoint (https://...)
 * @param {string}   [opts.image]      Public URL to an image/logo
 * @param {Array}    [opts.services]   Additional service entries (A2A, MCP, etc.)
 * @param {Array}    [opts.registrations]  On-chain registration records
 * @returns {object}
 */
export function agentRegistration({
	name,
	description,
	endpoint,
	image = '',
	services = [],
	registrations = [],
}) {
	return {
		type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
		name,
		description,
		image,
		active: true,
		services: [{ name: 'web', endpoint }, ...services],
		registrations,
		supportedTrust: ['reputation'],
	};
}

/**
 * Generate an A2A agent-card.json document.
 *
 * @param {object} opts
 * @param {string}   opts.name         Agent display name
 * @param {string}   opts.description  Agent description
 * @param {string}   opts.url          Agent base URL
 * @param {string}   [opts.version]    Semver string
 * @param {string}   [opts.org]        Organization name
 * @param {Array}    [opts.skills]     Array of A2A skill objects
 * @returns {object}
 */
export function agentCard({ name, description, url, version = '1.0.0', org = '', skills = [] }) {
	return {
		name,
		description,
		url,
		provider: {
			organization: org || name,
			url,
		},
		version,
		capabilities: {
			streaming: false,
			pushNotifications: false,
			stateTransitionHistory: false,
		},
		authentication: {
			schemes: ['bearer'],
			credentials: null,
		},
		defaultInputModes: ['text/plain', 'application/json'],
		defaultOutputModes: ['text/plain', 'application/json'],
		skills,
	};
}

/**
 * Generate an ai-plugin.json (OpenAI plugin manifest).
 *
 * @param {object} opts
 * @param {string}   opts.name         Human-readable name
 * @param {string}   opts.description  Plugin description
 * @param {string}   opts.openapiUrl   URL to your OpenAPI spec
 * @param {string}   [opts.logoUrl]    Public logo URL
 * @param {string}   [opts.contactEmail]
 * @param {string}   [opts.legalUrl]
 * @returns {object}
 */
export function aiPlugin({
	name,
	description,
	openapiUrl,
	logoUrl = '',
	contactEmail = '',
	legalUrl = '',
}) {
	const modelName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
	return {
		schema_version: 'v1',
		name_for_human: name,
		name_for_model: modelName,
		description_for_human: description,
		description_for_model: description,
		auth: { type: 'none' },
		api: { type: 'openapi', url: openapiUrl },
		logo_url: logoUrl,
		contact_email: contactEmail,
		legal_info_url: legalUrl,
	};
}
