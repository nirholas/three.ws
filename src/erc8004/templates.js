/**
 * Pre-filled agent templates — seed the Create wizard with one click.
 *
 * Each template populates Identity (name, description) + Services. Users can
 * still edit everything before deploying.
 */

/**
 * @typedef {Object} AgentTemplate
 * @property {string} id           Unique key.
 * @property {string} emoji        Display icon.
 * @property {string} name         Card title & default agent name.
 * @property {string} description  Card copy & default agent description.
 * @property {Array<{name: string, endpoint: string, version?: string}>} services
 * @property {{trust?: string[], x402?: boolean}} [config]
 */

/** @type {AgentTemplate[]} */
export const TEMPLATES = [
	{
		id: 'defi-trading',
		emoji: '📈',
		name: 'DeFi Trading Agent',
		description: 'Automated DeFi yield optimization, liquidity management, and token swaps across protocols.',
		services: [
			{ name: 'A2A', endpoint: 'https://your-agent.example/a2a', version: '1.0' },
			{ name: 'MCP', endpoint: 'https://your-agent.example/mcp', version: '1.0' },
		],
		config: { trust: ['reputation'], x402: true },
	},
	{
		id: 'support-bot',
		emoji: '🎧',
		name: 'Customer Support Bot',
		description: 'AI-powered support agent for handling tickets, FAQ queries, and multi-language communication.',
		services: [
			{ name: 'A2A', endpoint: 'https://your-agent.example/a2a', version: '1.0' },
		],
		config: { trust: ['reputation'], x402: false },
	},
	{
		id: 'code-review',
		emoji: '🔍',
		name: 'Code Review Agent',
		description: 'Automated code analysis, security auditing, gas optimization, and best practice enforcement.',
		services: [
			{ name: 'A2A', endpoint: 'https://your-agent.example/a2a', version: '1.0' },
			{ name: 'MCP', endpoint: 'https://your-agent.example/mcp', version: '1.0' },
		],
		config: { trust: ['reputation', 'validation'], x402: true },
	},
	{
		id: 'data-analysis',
		emoji: '📊',
		name: 'Data Analysis Agent',
		description: 'On-chain and off-chain data analysis, reporting, visualization, and pattern recognition.',
		services: [
			{ name: 'A2A', endpoint: 'https://your-agent.example/a2a', version: '1.0' },
			{ name: 'OASF', endpoint: 'https://your-agent.example/oasf', version: '1.0' },
		],
		config: { trust: ['reputation'], x402: true },
	},
	{
		id: 'content-creator',
		emoji: '✍️',
		name: 'Content Creator',
		description: 'AI content generation for social media, documentation, technical writing, and marketing.',
		services: [
			{ name: 'A2A', endpoint: 'https://your-agent.example/a2a', version: '1.0' },
		],
		config: { trust: ['reputation'], x402: true },
	},
	{
		id: 'research-assistant',
		emoji: '🔬',
		name: 'Research Assistant',
		description: 'Deep research on protocols, tokens, governance proposals, and market trends.',
		services: [
			{ name: 'A2A', endpoint: 'https://your-agent.example/a2a', version: '1.0' },
			{ name: 'MCP', endpoint: 'https://your-agent.example/mcp', version: '1.0' },
		],
		config: { trust: ['reputation'], x402: true },
	},
];

/**
 * @param {string} id
 * @returns {AgentTemplate|null}
 */
export function getTemplate(id) {
	return TEMPLATES.find((t) => t.id === id) || null;
}
