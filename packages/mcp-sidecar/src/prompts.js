export const PROMPTS = [
	{
		name: 'analyze-token',
		description: 'Full pump.fun token analysis — trust signals, creator history, bonding-curve progress, and a buy/skip/watch recommendation.',
		arguments: [
			{ name: 'mint', description: 'SPL mint address (base58)', required: true },
		],
	},
	{
		name: 'agent-trust',
		description: 'Evaluate a Solana agent — passport, reputation score, recent attestations, and a Trusted / Caution / Unverified verdict.',
		arguments: [
			{ name: 'asset', description: 'Metaplex Core asset pubkey (base58)', required: true },
			{ name: 'network', description: 'mainnet or devnet (default: mainnet)', required: false },
		],
	},
	{
		name: 'validate-model',
		description: 'Validate a glTF/GLB model, report structural issues, and list prioritised optimization recommendations.',
		arguments: [
			{ name: 'url', description: 'HTTPS URL to a .glb or .gltf file', required: true },
		],
	},
	{
		name: 'mint-to-avatar',
		description: 'Render a Solana SPL token as a branded 3D GLB avatar cube and return an embeddable viewer.',
		arguments: [
			{ name: 'mint', description: 'SPL mint address (base58)', required: true },
		],
	},
];

export function getPrompt(name, args) {
	switch (name) {
		case 'analyze-token': {
			const mint = args?.mint ?? '<mint>';
			return {
				description: `Pump.fun token analysis for ${mint}`,
				messages: [{
					role: 'user',
					content: { type: 'text', text: [
						`Analyze pump.fun token: ${mint}`,
						'',
						'1. Call pumpfun_creator_intel first to assess the creator wallet.',
						'2. Call pumpfun_token_intel for full token intelligence.',
						'3. Cross-reference: does the creator history match the token signals?',
						'4. Check the three-ws://pump/curve/{mint} resource for live bonding-curve progress.',
						'5. Give a clear BUY / SKIP / WATCH recommendation with specific reasons.',
					].join('\n') },
				}],
			};
		}

		case 'agent-trust': {
			const asset = args?.asset ?? '<asset>';
			const network = args?.network ?? 'mainnet';
			return {
				description: `Trust evaluation for Solana agent ${asset}`,
				messages: [{
					role: 'user',
					content: { type: 'text', text: [
						`Evaluate Solana agent asset: ${asset} on ${network}`,
						'',
						'1. Call solana_agent_passport to get identity, reputation, and recent attestations.',
						'2. Compare verified score vs raw score — a large gap means many unverified reviews.',
						'3. Note dispute count and validation pass/fail rate.',
						'4. Summarise the 3 most recent attestations.',
						'5. Return verdict: TRUSTED / CAUTION / UNVERIFIED with a one-paragraph justification.',
					].join('\n') },
				}],
			};
		}

		case 'validate-model': {
			const url = args?.url ?? '<url>';
			return {
				description: `glTF/GLB validation for ${url}`,
				messages: [{
					role: 'user',
					content: { type: 'text', text: [
						`Validate the 3D model at: ${url}`,
						'',
						'1. Call validate_model with the URL.',
						'2. If it passes with zero errors, report it as clean and skip step 3.',
						'3. If issues found, call inspect_model for detailed geometry/texture stats.',
						'4. List issues in priority order: errors → warnings → hints.',
						'5. Give actionable optimization recommendations (polygon reduction, texture compression, etc.).',
					].join('\n') },
				}],
			};
		}

		case 'mint-to-avatar': {
			const mint = args?.mint ?? '<mint>';
			return {
				description: `Render ${mint} as a 3D avatar`,
				messages: [{
					role: 'user',
					content: { type: 'text', text: [
						`Render Solana token ${mint} as a 3D avatar cube.`,
						'',
						'1. Fetch the three-ws://pump/curve/{mint} resource for token context.',
						'2. Call render_avatar (or use the /api/x402/mint-to-mesh endpoint) with the mint address.',
						'3. Return the embeddable <model-viewer> HTML for the generated GLB.',
						'4. Include token name, symbol, and price from the curve data as a caption.',
					].join('\n') },
				}],
			};
		}

		default:
			throw new Error(`unknown prompt: ${name}`);
	}
}
