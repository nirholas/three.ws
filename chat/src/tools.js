export const defaultToolSchema = [
	{
		name: 'Client-side',
		schema: [
			{
				clientDefinition: {
					id: '95c15b96-7bba-44e7-98a7-ffe268b884c5',
					name: 'Artifact',
					description: 'Displays the provided HTML content as a webpage to the user.',
					arguments: [
						{
							name: 'htmlContent',
							type: 'string',
							description: 'The HTML content to be displayed as a webpage',
						},
					],
					body: "return { contentType: 'text/html' };",
				},
				type: 'function',
				function: {
					name: 'Artifact',
					description: 'Displays the provided HTML content as a webpage to the user.',
					parameters: {
						type: 'object',
						properties: {
							htmlContent: {
								type: 'string',
								description: 'The HTML content to be displayed as a webpage',
							},
						},
						required: ['htmlContent'],
					},
				},
			},
			{
				clientDefinition: {
					id: '1407c581-fab6-4dd5-995a-d53ba05ec6e8',
					name: 'JavaScript',
					description: 'Evaluates JavaScript code and returns the result, including console output',
					arguments: [
						{
							name: 'code',
							type: 'string',
							description:
								'The JavaScript code to be evaluated. To return a value, you must use the return statement.',
						},
					],
					body: "let consoleOutput = [];\nconst originalConsoleLog = console.log;\nconsole.log = (...args) => {\n  consoleOutput.push(args.map(arg => JSON.stringify(arg)).join(' '));\n  originalConsoleLog.apply(console, args);\n};\n\ntry {\n  let result = eval(`(() => { ${args.code} })()`);\n  return JSON.stringify({\n    result: result,\n    consoleOutput: consoleOutput\n  }, null, 2);\n} catch (error) {\n  return JSON.stringify({\n    error: error.message,\n    consoleOutput: consoleOutput\n  }, null, 2);\n} finally {\n  console.log = originalConsoleLog;\n}",
				},
				type: 'function',
				function: {
					name: 'JavaScript',
					description: 'Evaluates JavaScript code and returns the result, including console output',
					parameters: {
						type: 'object',
						properties: {
							code: {
								type: 'string',
								description:
									'The JavaScript code to be evaluated. To return a value, you must use the return statement.',
							},
						},
						required: ['code'],
					},
				},
			},
			{
				clientDefinition: {
					id: '5b9b21b8-c8f2-40df-aea7-9634dec55b6b',
					name: 'Choice',
					description:
						'Prompts the user to select one of the given options. Use this when you need the user to choose between different options.',
					arguments: [
						{
							name: 'choices',
							type: 'string_array',
							description: 'The options the user can choose from.',
						},
						{
							name: 'question',
							type: 'string',
							description: 'What you are asking the user.',
						},
					],
					body: 'return await choose(args.question, args.choices);',
				},
				type: 'function',
				function: {
					name: 'Choice',
					description:
						'Prompts the user to select one of the given options. Use this when you need the user to choose between different options.',
					parameters: {
						type: 'object',
						properties: {
							choices: {
								type: 'array',
								items: {
									type: 'string',
								},
								description: 'The options the user can choose from.',
							},
							question: {
								type: 'string',
								description: 'What you are asking the user.',
							},
						},
						required: ['choices', 'question'],
					},
				},
			},
		],
	},
];

export const agentToolSchema = {
	name: '3D Agent',
	schema: [
		{
			clientDefinition: {
				id: 'agent-wave-a1b2c3',
				name: 'agent_wave',
				description: 'Makes the 3D avatar wave at the user.',
				arguments: [],
				body: 'if (window.__threewsAgent) window.__threewsAgent.wave(); return "waved";',
			},
			type: 'function',
			function: {
				name: 'agent_wave',
				description: 'Wave the 3D avatar at the user. Use to greet or celebrate.',
				parameters: { type: 'object', properties: {} },
			},
		},
		{
			clientDefinition: {
				id: 'agent-express-d4e5f6',
				name: 'agent_express',
				description: 'Express an emotion on the 3D avatar.',
				arguments: [
					{ name: 'trigger', type: 'string', description: 'celebration | concern | curiosity | empathy | patience' },
				],
				body: 'if (window.__threewsAgent) window.__threewsAgent.expressEmotion(args.trigger); return "expressed: " + args.trigger;',
			},
			type: 'function',
			function: {
				name: 'agent_express',
				description: 'Make the 3D avatar express an emotion. Use to show enthusiasm, empathy, or concern.',
				parameters: {
					type: 'object',
					properties: {
						trigger: {
							type: 'string',
							enum: ['celebration', 'concern', 'curiosity', 'empathy', 'patience'],
							description: 'The emotion to express.',
						},
					},
					required: ['trigger'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'agent-speak-g7h8i9',
				name: 'agent_speak',
				description: 'Trigger the avatar talking animation for a given text.',
				arguments: [{ name: 'text', type: 'string', description: 'Text to animate talking for' }],
				body: 'if (window.__threewsAgent) window.__threewsAgent.speak(args.text); return "speaking";',
			},
			type: 'function',
			function: {
				name: 'agent_speak',
				description: 'Trigger the 3D avatar talking animation. Useful for emphasis on a key statement.',
				parameters: {
					type: 'object',
					properties: {
						text: { type: 'string', description: 'The text being spoken (used to calculate animation duration).' },
					},
					required: ['text'],
				},
			},
		},
	],
};

const _pumpMcp = `
const _r = await fetch('/api/pump-fun-mcp', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:_TOOL_,arguments:args}})});
const _d = await _r.json();
if (_d.error) return JSON.stringify({error: _d.error.message});
const _c = _d.result?.content;
return Array.isArray(_c) ? _c.map(x => x.text || JSON.stringify(x)).join('\\n') : JSON.stringify(_c, null, 2);
`.trim();

function pumpBody(toolName) {
	return _pumpMcp.replace('_TOOL_', JSON.stringify(toolName));
}

export const pumpToolSchema = {
	name: 'Pump.fun & Crypto',
	schema: [
		{
			clientDefinition: {
				id: 'pump-trending-001',
				name: 'getTrendingTokens',
				description: 'Top pump.fun tokens by market cap.',
				arguments: [{ name: 'limit', type: 'number', description: 'Number of tokens (max 50, default 10)' }],
				body: pumpBody('getTrendingTokens'),
			},
			type: 'function',
			function: {
				name: 'getTrendingTokens',
				description: 'Get the top trending pump.fun tokens by market cap right now.',
				parameters: {
					type: 'object',
					properties: { limit: { type: 'integer', default: 10, description: 'How many tokens to return (max 50)' } },
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-new-002',
				name: 'getNewTokens',
				description: 'Most recently launched pump.fun tokens.',
				arguments: [{ name: 'limit', type: 'number', description: 'Number of tokens (max 50, default 10)' }],
				body: pumpBody('getNewTokens'),
			},
			type: 'function',
			function: {
				name: 'getNewTokens',
				description: 'Get the most recently launched pump.fun tokens.',
				parameters: {
					type: 'object',
					properties: { limit: { type: 'integer', default: 10, description: 'How many tokens to return (max 50)' } },
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-koth-003',
				name: 'getKingOfTheHill',
				description: 'Highest-market-cap token still on the bonding curve.',
				arguments: [],
				body: pumpBody('getKingOfTheHill'),
			},
			type: 'function',
			function: {
				name: 'getKingOfTheHill',
				description: 'Get the king of the hill — the highest market cap pump.fun token still on the bonding curve.',
				parameters: { type: 'object', properties: {} },
			},
		},
		{
			clientDefinition: {
				id: 'pump-search-004',
				name: 'searchTokens',
				description: 'Search pump.fun tokens by name, symbol, or mint address.',
				arguments: [
					{ name: 'query', type: 'string', description: 'Search query' },
					{ name: 'limit', type: 'number', description: 'Number of results (max 50, default 10)' },
				],
				body: pumpBody('searchTokens'),
			},
			type: 'function',
			function: {
				name: 'searchTokens',
				description: 'Search pump.fun tokens by name, symbol, or mint address.',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'Token name, symbol, or mint address' },
						limit: { type: 'integer', default: 10, description: 'Number of results (max 50)' },
					},
					required: ['query'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-details-005',
				name: 'getTokenDetails',
				description: 'Full details for a specific pump.fun token by mint address.',
				arguments: [{ name: 'mint', type: 'string', description: 'Token mint address (base58)' }],
				body: pumpBody('getTokenDetails'),
			},
			type: 'function',
			function: {
				name: 'getTokenDetails',
				description: 'Get full details for a pump.fun token: price, market cap, description, socials, creator.',
				parameters: {
					type: 'object',
					properties: { mint: { type: 'string', description: 'Token mint address (base58)' } },
					required: ['mint'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-curve-006',
				name: 'getBondingCurve',
				description: 'Bonding curve analysis: reserves and graduation progress.',
				arguments: [{ name: 'mint', type: 'string', description: 'Token mint address (base58)' }],
				body: pumpBody('getBondingCurve'),
			},
			type: 'function',
			function: {
				name: 'getBondingCurve',
				description: 'Get bonding curve reserves and graduation progress (0-100%) for a pump.fun token.',
				parameters: {
					type: 'object',
					properties: { mint: { type: 'string', description: 'Token mint address (base58)' } },
					required: ['mint'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-trades-007',
				name: 'getTokenTrades',
				description: 'Recent buy/sell history for a token.',
				arguments: [
					{ name: 'mint', type: 'string', description: 'Token mint address (base58)' },
					{ name: 'limit', type: 'number', description: 'Number of trades (max 200, default 50)' },
				],
				body: pumpBody('getTokenTrades'),
			},
			type: 'function',
			function: {
				name: 'getTokenTrades',
				description: 'Get recent buy/sell trade history for a pump.fun token.',
				parameters: {
					type: 'object',
					properties: {
						mint: { type: 'string', description: 'Token mint address (base58)' },
						limit: { type: 'integer', default: 50, description: 'Number of trades (max 200)' },
					},
					required: ['mint'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-holders-008',
				name: 'getTokenHolders',
				description: 'Token holder distribution and concentration.',
				arguments: [{ name: 'mint', type: 'string', description: 'Token mint address (base58)' }],
				body: pumpBody('getTokenHolders'),
			},
			type: 'function',
			function: {
				name: 'getTokenHolders',
				description: 'Get top token holders and concentration metrics for a pump.fun token.',
				parameters: {
					type: 'object',
					properties: { mint: { type: 'string', description: 'Token mint address (base58)' } },
					required: ['mint'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-quote-009',
				name: 'pumpfun_quote_swap',
				description: 'Read-only price quote for a pump.fun swap.',
				arguments: [
					{ name: 'inputMint', type: 'string', description: 'Input token mint (use So11111111111111111111111111111111111111112 for SOL)' },
					{ name: 'outputMint', type: 'string', description: 'Output token mint' },
					{ name: 'amountIn', type: 'number', description: 'Amount in lamports (1 SOL = 1000000000)' },
				],
				body: pumpBody('pumpfun_quote_swap'),
			},
			type: 'function',
			function: {
				name: 'pumpfun_quote_swap',
				description: 'Get a read-only price quote for swapping on pump.fun. Use SOL mint So11111111111111111111111111111111111111112 for SOL side.',
				parameters: {
					type: 'object',
					properties: {
						inputMint: { type: 'string', description: 'Input token mint address' },
						outputMint: { type: 'string', description: 'Output token mint address' },
						amountIn: { type: 'number', description: 'Input amount in raw lamports (1 SOL = 1_000_000_000)' },
						slippageBps: { type: 'number', description: 'Slippage in basis points (default 100 = 1%)' },
					},
					required: ['inputMint', 'outputMint', 'amountIn'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-sns-010',
				name: 'sns_resolve',
				description: 'Resolve a .sol domain to a wallet address.',
				arguments: [{ name: 'name', type: 'string', description: '.sol domain name e.g. "bonfida.sol"' }],
				body: pumpBody('sns_resolve'),
			},
			type: 'function',
			function: {
				name: 'sns_resolve',
				description: 'Resolve a Solana Name Service (.sol) domain to its owner wallet address.',
				parameters: {
					type: 'object',
					properties: { name: { type: 'string', description: '.sol domain name, e.g. "bonfida.sol"' } },
					required: ['name'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-sns-rev-011',
				name: 'sns_reverseLookup',
				description: 'Reverse-lookup a Solana wallet to its .sol domain.',
				arguments: [{ name: 'address', type: 'string', description: 'Base58 Solana wallet address' }],
				body: pumpBody('sns_reverseLookup'),
			},
			type: 'function',
			function: {
				name: 'sns_reverseLookup',
				description: 'Look up the .sol domain name for a Solana wallet address.',
				parameters: {
					type: 'object',
					properties: { address: { type: 'string', description: 'Base58 Solana wallet address' } },
					required: ['address'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-kol-012',
				name: 'kol_radar',
				description: 'Early-detection signals for memecoins from KOL wallets.',
				arguments: [{ name: 'limit', type: 'number', description: 'Number of signals (default 20)' }],
				body: pumpBody('kol_radar'),
			},
			type: 'function',
			function: {
				name: 'kol_radar',
				description: 'Get early-detection alpha signals from key opinion leader (KOL) wallets on pump.fun.',
				parameters: {
					type: 'object',
					properties: { limit: { type: 'integer', default: 20, description: 'Number of signals to return' } },
				},
			},
		},
	],
};
