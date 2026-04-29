/**
 * Pump.fun skills for Solana agents
 * ---------------------------------
 * Wraps @nirholas/pump-sdk so an agent can launch its own coin, buy, sell,
 * and report bonding-curve state through chat / MCP.
 *
 * Skills registered:
 *   - pumpfun-create   → mint a new token whose metadata points at the agent
 *   - pumpfun-buy      → buy on the bonding curve with SOL
 *   - pumpfun-sell     → sell tokens back to the curve
 *   - pumpfun-status   → market cap + graduation progress for a mint
 *
 * Wallet: uses the same injected Solana wallet as src/erc8004/solana-deploy.js
 * (Phantom / Backpack / Solflare). All txs are signed by the agent owner;
 * this module never holds keys.
 *
 * SDK is loaded lazily so non-Solana agents don't pay the import cost.
 */

import { detectSolanaWallet, SOLANA_RPC } from './erc8004/solana-deploy.js';

const DEFAULT_NETWORK = 'mainnet';

async function loadSdk() {
	const [{ OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount }, web3, BN] =
		await Promise.all([
			import('@nirholas/pump-sdk'),
			import('@solana/web3.js'),
			import('bn.js').then((m) => m.default || m),
		]);
	return { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount, web3, BN };
}

function getConnection(web3, network) {
	const url = SOLANA_RPC[network] || SOLANA_RPC[DEFAULT_NETWORK];
	return new web3.Connection(url, 'confirmed');
}

async function requireWallet() {
	const wallet = detectSolanaWallet();
	if (!wallet) throw new Error('No Solana wallet detected. Install Phantom to continue.');
	if (!wallet.isConnected) await wallet.connect();
	const pubkey = wallet.publicKey;
	if (!pubkey) throw new Error('Could not read Solana wallet address.');
	return { wallet, pubkey };
}

async function sendIxs({ web3, connection, wallet, payer, instructions, extraSigners = [] }) {
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
	const tx = new web3.Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
	tx.add(...instructions);
	if (extraSigners.length) tx.partialSign(...extraSigners);
	const signed = await wallet.signTransaction(tx);
	const sig = await connection.sendRawTransaction(signed.serialize(), {
		skipPreflight: false,
	});
	await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
	return sig;
}

/**
 * Register pump.fun skills onto an AgentSkills instance.
 * @param {import('./agent-skills.js').AgentSkills} skills
 */
export function registerPumpFunSkills(skills) {
	skills.register({
		name: 'pumpfun-create',
		description:
			'Launch a pump.fun token on Solana whose metadata points at this agent. Returns the mint address and tx signature.',
		instruction:
			'Mint a new pump.fun token. The agent owner signs. Name/symbol default to the agent identity.',
		animationHint: 'celebrate',
		voicePattern: 'Launching {{symbol}} on pump.fun…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Token name (defaults to agent name)' },
				symbol: { type: 'string', description: 'Ticker, ≤10 chars' },
				uri: {
					type: 'string',
					description: 'Metadata JSON URI (Arweave/IPFS). Should reference the agent GLB + bio.',
				},
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['symbol', 'uri'],
		},
		handler: async (args, ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const tokenName = args.name || ctx.identity?.name || 'Agent';
			const symbol = String(args.symbol).toUpperCase().slice(0, 10);

			const { PUMP_SDK, web3 } = await loadSdk();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mintKeypair = web3.Keypair.generate();
			const createIx = await PUMP_SDK.createV2Instruction({
				mint: mintKeypair.publicKey,
				name: tokenName,
				symbol,
				uri: args.uri,
				creator: pubkey,
				user: pubkey,
				mayhemMode: false,
			});

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: [createIx],
				extraSigners: [mintKeypair],
			});

			return {
				success: true,
				output: `Launched ${symbol} on pump.fun. Mint: ${mintKeypair.publicKey.toBase58()}`,
				sentiment: 0.9,
				data: {
					mint: mintKeypair.publicKey.toBase58(),
					signature: sig,
					network,
					name: tokenName,
					symbol,
				},
			};
		},
	});

	skills.register({
		name: 'pumpfun-buy',
		description: 'Buy a pump.fun token with SOL on the bonding curve.',
		instruction: 'Buy tokens for the agent owner.',
		animationHint: 'gesture',
		voicePattern: 'Buying {{solAmount}} SOL of {{mint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				solAmount: { type: 'number', description: 'Amount of SOL to spend' },
				slippageBps: { type: 'number', description: 'Slippage tolerance, bps (default 500)' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['mint', 'solAmount'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const slippageBps = args.slippageBps ?? 500;
			const { OnlinePumpSdk, getBuyTokenAmountFromSolAmount, web3, BN } = await loadSdk();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const sdk = new OnlinePumpSdk(connection);
			const lamports = new BN(Math.floor(args.solAmount * web3.LAMPORTS_PER_SOL));

			const curve = await sdk.fetchBondingCurve(mint);
			const expectedTokens = getBuyTokenAmountFromSolAmount({
				bondingCurve: curve,
				solAmount: lamports,
			});

			const buyIxs = await sdk.buyInstructions({
				mint,
				user: pubkey,
				solAmount: lamports,
				tokenAmount: expectedTokens,
				slippageBps,
			});

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: buyIxs,
			});

			return {
				success: true,
				output: `Bought ~${expectedTokens.toString()} units of ${args.mint.slice(0, 8)}… for ${args.solAmount} SOL.`,
				sentiment: 0.6,
				data: { signature: sig, mint: args.mint, solAmount: args.solAmount, network },
			};
		},
	});

	skills.register({
		name: 'pumpfun-sell',
		description: 'Sell a pump.fun token back to the bonding curve for SOL.',
		instruction: 'Sell tokens held by the agent owner.',
		animationHint: 'gesture',
		voicePattern: 'Selling {{tokenAmount}} of {{mint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				tokenAmount: { type: 'string', description: 'Token amount as base-unit integer string' },
				slippageBps: { type: 'number' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['mint', 'tokenAmount'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const slippageBps = args.slippageBps ?? 500;
			const { OnlinePumpSdk, web3, BN } = await loadSdk();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const sdk = new OnlinePumpSdk(connection);
			const tokenAmount = new BN(args.tokenAmount);

			const sellIxs = await sdk.sellInstructions({
				mint,
				user: pubkey,
				tokenAmount,
				slippageBps,
			});

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: sellIxs,
			});

			return {
				success: true,
				output: `Sold ${args.tokenAmount} of ${args.mint.slice(0, 8)}…`,
				sentiment: 0.4,
				data: { signature: sig, mint: args.mint, network },
			};
		},
	});

	skills.register({
		name: 'pumpfun-status',
		description:
			'Read live bonding-curve state for a pump.fun mint: market cap, graduation progress.',
		instruction: 'Read-only. Safe to call without a connected wallet.',
		animationHint: 'inspect',
		voicePattern: '{{symbol}} is at {{progress}}% to graduation.',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['mint'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { OnlinePumpSdk, web3 } = await loadSdk();
			const connection = getConnection(web3, network);
			const sdk = new OnlinePumpSdk(connection);

			const summary = await sdk.fetchBondingCurveSummary(new web3.PublicKey(args.mint));
			const progressPct = (summary.progressBps ?? 0) / 100;
			const graduated = !!summary.isGraduated;

			return {
				success: true,
				output: graduated
					? `Graduated to AMM. Market cap ~${summary.marketCap?.toString()} lamports.`
					: `${progressPct.toFixed(1)}% to graduation. Market cap ~${summary.marketCap?.toString()} lamports.`,
				sentiment: graduated ? 0.7 : 0.2,
				data: {
					mint: args.mint,
					marketCap: summary.marketCap?.toString(),
					progressBps: summary.progressBps,
					graduated,
					network,
				},
			};
		},
	});
}
