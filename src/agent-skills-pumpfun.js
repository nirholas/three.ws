/**
 * Pump.fun skills for Solana agents
 * ---------------------------------
 * Wraps the official @pump-fun SDKs so an agent can:
 *   - launch a token (bonding curve)        → pumpfun-create
 *   - launch one auto-derived from identity → pumpfun-launch-from-agent
 *   - trade on the curve                    → pumpfun-buy / pumpfun-sell
 *   - trade on the AMM (post-graduation)    → pumpfun-amm-buy / pumpfun-amm-sell
 *   - read live curve state                 → pumpfun-status
 *   - claim creator fees                    → pumpfun-claim-fees
 *   - accept paid invocations               → pumpfun-accept-payment
 *
 * Wallet: uses the same injected Solana wallet as src/erc8004/solana-deploy.js
 * (Phantom / Backpack / Solflare). All txs are signed by the agent owner;
 * this module never holds keys.
 *
 * SDKs are loaded lazily so non-Solana agents don't pay the import cost.
 */

import { detectSolanaWallet, SOLANA_RPC } from './erc8004/solana-deploy.js';
import { quoteSwap } from './pump/pump-swap-quote.js';
import { fetchChannelFeed } from './pump/channel-feed.js';
import { listRecentClaims } from './pump/pumpkit-claims.js';
import { getWalletPnl } from './kol/wallet-pnl.js';
import { getRadarSignals } from './kol/radar.js';
import { resolveSnsName, reverseLookupAddress } from './solana/sns.js';
import { correlateXPost } from './social/x-post-impact.js';

const DEFAULT_NETWORK = 'mainnet';
const DEFAULT_SLIPPAGE_BPS = 500;

async function loadCore() {
	const [pump, web3, BN, splToken] = await Promise.all([
		import('@pump-fun/pump-sdk'),
		import('@solana/web3.js'),
		import('bn.js').then((m) => m.default || m),
		import('@solana/spl-token').catch(() => null),
	]);
	return { pump, web3, BN, splToken };
}

async function loadAmm() {
	const [amm, web3, BN] = await Promise.all([
		import('@pump-fun/pump-swap-sdk'),
		import('@solana/web3.js'),
		import('bn.js').then((m) => m.default || m),
	]);
	return { amm, web3, BN };
}

async function loadAgentPayments() {
	const [pay, web3] = await Promise.all([
		import('@pump-fun/agent-payments-sdk'),
		import('@solana/web3.js'),
	]);
	return { pay, web3 };
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
	const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
	await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
	return sig;
}

/**
 * Run the prep → wallet-sign → confirm round-trip against three.ws server-side
 * pump.fun endpoints. The server validates ownership + builds the unsigned tx;
 * the wallet only signs. Useful for clients that want server-enforced policy
 * (rate-limit, agent ownership) without re-implementing pump SDK glue.
 *
 * @param {Object} opts
 * @param {string} opts.prepPath — e.g. '/api/pump/buy-prep'
 * @param {Object} opts.body — request body for the prep endpoint
 * @param {string} [opts.confirmPath] — e.g. '/api/pump/launch-confirm'; if set,
 *                 calls confirm with `{ tx_signature, ...confirmExtra }`
 * @param {Object} [opts.confirmExtra] — additional fields to include in confirm body
 * @param {string} [opts.origin] — defaults to current page origin
 * @returns {Promise<{ signature: string, prep: Object, confirm: Object|null }>}
 */
export async function runServerFlow({
	prepPath,
	body,
	confirmPath,
	confirmExtra = {},
	origin = '',
}) {
	const [{ VersionedTransaction }] = await Promise.all([import('@solana/web3.js')]);
	const { wallet } = await requireWallet();
	const network = body.network || DEFAULT_NETWORK;

	const prepRes = await fetch(`${origin}${prepPath}`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	const prep = await prepRes.json();
	if (!prepRes.ok) {
		throw new Error(prep.error_description || prep.error || `prep failed: ${prepRes.status}`);
	}
	if (!prep.tx_base64) throw new Error('prep response missing tx_base64');

	const tx = VersionedTransaction.deserialize(
		Uint8Array.from(atob(prep.tx_base64), (c) => c.charCodeAt(0)),
	);
	const signed = await wallet.signTransaction(tx);

	const { Connection } = await import('@solana/web3.js');
	const url = SOLANA_RPC[network] || SOLANA_RPC[DEFAULT_NETWORK];
	const connection = new Connection(url, 'confirmed');
	const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
	const latest = await connection.getLatestBlockhash();
	await connection.confirmTransaction(
		{
			signature: sig,
			blockhash: latest.blockhash,
			lastValidBlockHeight: latest.lastValidBlockHeight,
		},
		'confirmed',
	);

	let confirmJson = null;
	if (confirmPath) {
		const extra = typeof confirmExtra === 'function' ? confirmExtra(prep) : confirmExtra;
		const confirmRes = await fetch(`${origin}${confirmPath}`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tx_signature: sig, ...extra }),
		});
		confirmJson = await confirmRes.json();
		if (!confirmRes.ok) {
			throw new Error(
				confirmJson.error_description ||
					confirmJson.error ||
					`confirm failed: ${confirmRes.status}`,
			);
		}
	}

	return { signature: sig, prep, confirm: confirmJson };
}

function deriveSymbol(name) {
	return (
		String(name || 'AGENT')
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '')
			.slice(0, 10) || 'AGENT'
	);
}

/**
 * Register pump.fun skills onto an AgentSkills instance.
 * @param {import('./agent-skills.js').AgentSkills} skills
 */
export function registerPumpFunSkills(skills) {
	// ── pumpfun-create ────────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-create',
		description:
			'Launch a pump.fun token on Solana. Owner signs. Returns mint address + tx signature.',
		instruction: 'Mint a new pump.fun token using the official @pump-fun/pump-sdk.',
		animationHint: 'celebrate',
		voicePattern: 'Launching {{symbol}} on pump.fun…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				symbol: { type: 'string', description: '≤10 chars' },
				uri: { type: 'string', description: 'Metaplex metadata URI' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
				initialBuySol: { type: 'number', description: 'Optional dev-buy in same tx (SOL)' },
				mintPublicKey: {
					type: 'string',
					description: 'Optional pre-ground vanity mint pubkey',
				},
				mintSecretKeyB64: {
					type: 'string',
					description: 'Base64 64-byte secret key paired with mintPublicKey',
				},
			},
			required: ['symbol', 'uri'],
		},
		handler: async (args, ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const tokenName = args.name || ctx.identity?.name || 'Agent';
			const symbol = deriveSymbol(args.symbol);

			const { pump, web3, BN } = await loadCore();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			let mintKeypair;
			if (args.mintPublicKey && args.mintSecretKeyB64) {
				const bin = atob(args.mintSecretKeyB64);
				const secret = Uint8Array.from(bin, (c) => c.charCodeAt(0));
				mintKeypair = web3.Keypair.fromSecretKey(secret);
			} else {
				mintKeypair = web3.Keypair.generate();
			}
			const offline = new pump.PumpSdk();
			let instructions;

			if (args.initialBuySol && args.initialBuySol > 0) {
				const onlineSdk = new pump.OnlinePumpSdk(connection);
				const global = await onlineSdk.fetchGlobal();
				const solLamports = new BN(Math.floor(args.initialBuySol * web3.LAMPORTS_PER_SOL));
				instructions = await offline.createV2AndBuyInstructions({
					global,
					mint: mintKeypair.publicKey,
					name: tokenName,
					symbol,
					uri: args.uri,
					creator: pubkey,
					user: pubkey,
					amount: new BN(0),
					solAmount: solLamports,
					mayhemMode: false,
				});
			} else {
				instructions = [
					await offline.createV2Instruction({
						mint: mintKeypair.publicKey,
						name: tokenName,
						symbol,
						uri: args.uri,
						creator: pubkey,
						user: pubkey,
						mayhemMode: false,
					}),
				];
			}

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions,
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

	// ── pumpfun-launch-from-agent ─────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-launch-from-agent',
		description:
			'One-shot: launch a pump.fun token whose metadata is auto-generated from this agent (name, GLB, bio).',
		instruction: 'Resolves the agent metadata URL, then calls pumpfun-create.',
		animationHint: 'celebrate',
		voicePattern: 'Launching myself on pump.fun…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
				initialBuySol: { type: 'number' },
				mintPublicKey: { type: 'string' },
				mintSecretKeyB64: { type: 'string' },
			},
		},
		handler: async (args, ctx) => {
			const id = ctx.identity?.id;
			if (!id) {
				return {
					success: false,
					output: 'No agent identity. Register the agent first.',
					sentiment: -0.3,
				};
			}
			const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
			const uri = `${origin}/api/agents/pumpfun-metadata?id=${encodeURIComponent(id)}`;
			const symbol = args.symbol || deriveSymbol(ctx.identity?.name);
			return skills.perform(
				'pumpfun-create',
				{
					name: ctx.identity?.name,
					symbol,
					uri,
					network: args.network,
					initialBuySol: args.initialBuySol,
					mintPublicKey: args.mintPublicKey,
					mintSecretKeyB64: args.mintSecretKeyB64,
				},
				ctx,
			);
		},
	});

	// ── pumpfun-buy ───────────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-buy',
		description: 'Buy a pump.fun token with SOL on the bonding curve.',
		instruction: 'Bonding-curve buy. Reverts if the token has graduated — use pumpfun-amm-buy.',
		animationHint: 'gesture',
		voicePattern: 'Buying {{solAmount}} SOL of {{mint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				solAmount: { type: 'number' },
				slippageBps: { type: 'number' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['mint', 'solAmount'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

			if (args.serverFlow) {
				const { pubkey: pk } = await requireWallet();
				const r = await runServerFlow({
					prepPath: '/api/pump/buy-prep',
					body: {
						mint: args.mint,
						network,
						sol: args.solAmount,
						slippage_bps: slippageBps,
						wallet_address: pk.toBase58(),
					},
					confirmPath: '/api/pump/buy-confirm',
					confirmExtra: (prep) => ({
						mint: args.mint,
						network,
						wallet_address: pk.toBase58(),
						sol: args.solAmount,
						slippage_bps: slippageBps,
						route: prep.route,
					}),
				});
				const route = r.prep.route;
				return {
					success: true,
					output: `Bought ~${args.solAmount} SOL of ${args.mint.slice(0, 8)}… via ${route}.`,
					sentiment: 0.6,
					data: {
						signature: r.signature,
						route,
						mint: args.mint,
						network,
						tracked: r.confirm?.tracked,
					},
				};
			}

			const { pump, web3, BN } = await loadCore();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const onlineSdk = new pump.OnlinePumpSdk(connection);
			const offline = new pump.PumpSdk();

			const global = await onlineSdk.fetchGlobal();
			const state = await onlineSdk.fetchBuyState(mint, pubkey);
			const solLamports = new BN(Math.floor(args.solAmount * web3.LAMPORTS_PER_SOL));
			const expected = pump.getBuyTokenAmountFromSolAmount({
				global,
				feeConfig: null,
				mintSupply: state.bondingCurve.tokenTotalSupply,
				bondingCurve: state.bondingCurve,
				amount: solLamports,
			});

			const buyIxs = await offline.buyInstructions({
				global,
				bondingCurveAccountInfo: state.bondingCurveAccountInfo,
				bondingCurve: state.bondingCurve,
				associatedUserAccountInfo: state.associatedUserAccountInfo,
				mint,
				user: pubkey,
				amount: expected,
				solAmount: solLamports,
				slippage: slippageBps / 10_000,
				tokenProgram:
					web3.TOKEN_PROGRAM_ID || (await import('@solana/spl-token')).TOKEN_PROGRAM_ID,
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
				output: `Bought ~${expected.toString()} units of ${args.mint.slice(0, 8)}… for ${args.solAmount} SOL.`,
				sentiment: 0.6,
				data: { signature: sig, mint: args.mint, solAmount: args.solAmount, network },
			};
		},
	});

	// ── pumpfun-sell ──────────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-sell',
		description: 'Sell a pump.fun token back to the bonding curve for SOL.',
		instruction: 'Bonding-curve sell. Reverts if graduated — use pumpfun-amm-sell.',
		animationHint: 'gesture',
		voicePattern: 'Selling {{tokenAmount}} of {{mint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				tokenAmount: { type: 'string', description: 'Base-unit integer string' },
				slippageBps: { type: 'number' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['mint', 'tokenAmount'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

			if (args.serverFlow) {
				const { pubkey: pk } = await requireWallet();
				const r = await runServerFlow({
					prepPath: '/api/pump/sell-prep',
					body: {
						mint: args.mint,
						network,
						tokens: String(args.tokenAmount),
						slippage_bps: slippageBps,
						wallet_address: pk.toBase58(),
					},
					confirmPath: '/api/pump/sell-confirm',
					confirmExtra: (prep) => ({
						mint: args.mint,
						network,
						wallet_address: pk.toBase58(),
						tokens: String(args.tokenAmount),
						slippage_bps: slippageBps,
						route: prep.route,
					}),
				});
				const route = r.prep.route;
				return {
					success: true,
					output: `Sold ${args.tokenAmount} of ${args.mint.slice(0, 8)}… via ${route}.`,
					sentiment: 0.4,
					data: {
						signature: r.signature,
						route,
						mint: args.mint,
						network,
						tracked: r.confirm?.tracked,
					},
				};
			}

			const { pump, web3, BN } = await loadCore();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const onlineSdk = new pump.OnlinePumpSdk(connection);
			const offline = new pump.PumpSdk();
			const global = await onlineSdk.fetchGlobal();
			const state = await onlineSdk.fetchSellState(mint, pubkey);

			const tokenAmount = new BN(args.tokenAmount);
			const expectedSol = pump.getSellSolAmountFromTokenAmount({
				global,
				feeConfig: null,
				mintSupply: state.bondingCurve.tokenTotalSupply,
				bondingCurve: state.bondingCurve,
				amount: tokenAmount,
			});

			const sellIxs = await offline.sellInstructions({
				global,
				bondingCurveAccountInfo: state.bondingCurveAccountInfo,
				bondingCurve: state.bondingCurve,
				mint,
				user: pubkey,
				amount: tokenAmount,
				solAmount: expectedSol,
				slippage: slippageBps / 10_000,
				tokenProgram: (await import('@solana/spl-token')).TOKEN_PROGRAM_ID,
				mayhemMode: false,
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

	// ── pumpfun-status ────────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-status',
		description: 'Read live state for a pump.fun mint: market cap, graduation status.',
		instruction: 'Read-only. No wallet required.',
		animationHint: 'inspect',
		voicePattern: '{{mint}} status',
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
			const { pump, web3, splToken } = await loadCore();
			const connection = getConnection(web3, network);
			const onlineSdk = new pump.OnlinePumpSdk(connection);
			const mint = new web3.PublicKey(args.mint);

			const curve = await onlineSdk.fetchBondingCurve(mint);
			const global = await onlineSdk.fetchGlobal();
			const graduated = !!curve.complete;
			const marketCap = pump.bondingCurveMarketCap({
				global,
				bondingCurve: curve,
			});

			let userBalance = '0';
			let owner = null;
			try {
				const wallet = detectSolanaWallet();
				if (wallet?.publicKey && splToken) {
					owner = wallet.publicKey;
					const ata = await splToken.getAssociatedTokenAddress(mint, owner);
					const acct = await connection.getTokenAccountBalance(ata).catch(() => null);
					userBalance = acct?.value?.amount ?? '0';
				}
			} catch {}

			return {
				success: true,
				output: graduated
					? `Graduated to AMM. Market cap ~${marketCap.toString()} lamports.`
					: `On bonding curve. Market cap ~${marketCap.toString()} lamports.`,
				sentiment: graduated ? 0.7 : 0.2,
				data: {
					mint: args.mint,
					marketCap: marketCap.toString(),
					graduated,
					userBalance,
					owner: owner ? owner.toBase58() : null,
					network,
				},
			};
		},
	});

	// ── pumpfun-amm-buy ───────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-amm-buy',
		description: 'Buy a graduated pump.fun token from the AMM pool with SOL.',
		instruction: 'AMM buy via @pump-fun/pump-swap-sdk. Use after graduation.',
		animationHint: 'gesture',
		voicePattern: 'AMM buy {{solAmount}} SOL of {{mint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				solAmount: { type: 'number' },
				slippageBps: { type: 'number' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['mint', 'solAmount'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const slippage = (args.slippageBps ?? DEFAULT_SLIPPAGE_BPS) / 10_000;
			const { amm, web3, BN } = await loadAmm();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const sdk = new amm.OnlinePumpAmmSdk(connection);
			const solLamports = new BN(Math.floor(args.solAmount * web3.LAMPORTS_PER_SOL));

			const ixs = await sdk.swapAutocompleteBaseFromQuote({
				pool: amm.canonicalPumpPoolPda(mint)[0],
				quote: solLamports,
				slippage,
				direction: 'quoteToBase',
				user: pubkey,
			});

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: Array.isArray(ixs) ? ixs : ixs.instructions || [],
			});

			return {
				success: true,
				output: `AMM-bought ${args.mint.slice(0, 8)}… for ${args.solAmount} SOL.`,
				sentiment: 0.6,
				data: { signature: sig, mint: args.mint, network },
			};
		},
	});

	// ── pumpfun-amm-sell ──────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-amm-sell',
		description: 'Sell a graduated pump.fun token to the AMM pool for SOL.',
		instruction: 'AMM sell via @pump-fun/pump-swap-sdk.',
		animationHint: 'gesture',
		voicePattern: 'AMM sell {{tokenAmount}} of {{mint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				tokenAmount: { type: 'string' },
				slippageBps: { type: 'number' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['mint', 'tokenAmount'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const slippage = (args.slippageBps ?? DEFAULT_SLIPPAGE_BPS) / 10_000;
			const { amm, web3, BN } = await loadAmm();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const sdk = new amm.OnlinePumpAmmSdk(connection);
			const tokenAmount = new BN(args.tokenAmount);

			const ixs = await sdk.swapAutocompleteQuoteFromBase({
				pool: amm.canonicalPumpPoolPda(mint)[0],
				base: tokenAmount,
				slippage,
				direction: 'baseToQuote',
				user: pubkey,
			});

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: Array.isArray(ixs) ? ixs : ixs.instructions || [],
			});

			return {
				success: true,
				output: `AMM-sold ${args.tokenAmount} of ${args.mint.slice(0, 8)}…`,
				sentiment: 0.4,
				data: { signature: sig, mint: args.mint, network },
			};
		},
	});

	// ── pumpfun-claim-fees ────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-claim-fees',
		description:
			'Claim accumulated creator fees from the agent-creator vault to the agent owner wallet.',
		instruction: 'Calls collectCoinCreatorFeeInstructions on OnlinePumpSdk.',
		animationHint: 'celebrate',
		voicePattern: 'Claiming creator fees…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: { network: { type: 'string', enum: ['mainnet', 'devnet'] } },
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { pump, web3 } = await loadCore();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const onlineSdk = new pump.OnlinePumpSdk(connection);
			const balance = await onlineSdk.getCreatorVaultBalanceBothPrograms(pubkey);
			if (balance.isZero?.() || balance.toString() === '0') {
				return {
					success: true,
					output: 'No creator fees to claim right now.',
					sentiment: 0.1,
					data: { lamports: '0' },
				};
			}

			const ixs = await onlineSdk.collectCoinCreatorFeeInstructions(pubkey, pubkey);
			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: ixs,
			});
			return {
				success: true,
				output: `Claimed ${balance.toString()} lamports of creator fees.`,
				sentiment: 0.8,
				data: { signature: sig, lamports: balance.toString(), network },
			};
		},
	});

	// ── pumpfun.channelFeed ───────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun.channelFeed',
		description: 'Fetch recent pump.fun signals (new mints, whale buys, creator claims) as a digest the LLM can summarize.',
		instruction: 'Read-only. No wallet required. Returns latest channel-feed items.',
		animationHint: 'inspect',
		voicePattern: 'Fetching pump.fun signal feed…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
				kinds: {
					type: 'string',
					description: 'Comma-separated filter: mint, whale, claim (default: all)',
				},
			},
		},
		handler: async (args, _ctx) => {
			const limit = args.limit ?? 20;
			const kinds = args.kinds ?? undefined;
			let data;
			try {
				data = await fetchChannelFeed({ limit, kinds });
			} catch (err) {
				return {
					success: false,
					output: `Failed to fetch channel feed: ${err.message}`,
					sentiment: -0.2,
				};
			}
			const items = data.items ?? [];
			if (!items.length) {
				return {
					success: true,
					output: 'No recent pump.fun signals found.',
					sentiment: 0,
					data: { items: [] },
				};
			}
			const digest = items
				.slice(0, 10)
				.map((i) => `[${i.kind}] ${i.mint?.slice(0, 8) ?? '?'}… ${i.summary}`.trimEnd())
				.join('\n');
			return {
				success: true,
				output: `${items.length} signal${items.length !== 1 ? 's' : ''}:\n${digest}`,
				sentiment: 0.3,
				data: { items },
			};
		},
	});

	// ── kol.radar ─────────────────────────────────────────────────────────────
	skills.register({
		name: 'kol.radar',
		description:
			'Return gmgn radar signals: early-detection patterns by category, sorted by score.',
		instruction: 'Read-only. Returns fixture data from src/kol/radar-fixture.json.',
		animationHint: 'inspect',
		voicePattern: 'Checking radar for {{category}} signals…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				category: {
					type: 'string',
					enum: ['pump-fun', 'new-mints', 'volume-spike'],
					default: 'pump-fun',
					description: 'Signal category to filter by',
				},
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 100,
					default: 20,
					description: 'Max results (capped at 100)',
				},
			},
		},
		handler: async (args, _ctx) => {
			const signals = await getRadarSignals({
				category: args.category ?? 'pump-fun',
				limit: args.limit ?? 20,
			});
			return {
				success: true,
				output: `Found ${signals.length} radar signal(s) for "${args.category ?? 'pump-fun'}".`,
				sentiment: signals.length > 0 ? 0.6 : 0.1,
				data: { signals, category: args.category ?? 'pump-fun', count: signals.length },
			};
		},
	});

	// ── pumpfun-accept-payment ────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-accept-payment',
		description:
			'Accept a paid invocation of this agent via @pump-fun/agent-payments-sdk. Splits revenue per the on-chain sharing config.',
		instruction:
			'Builds an accept_payment tx for a fixed price in a given currency mint. Caller signs as `user`.',
		animationHint: 'gesture',
		voicePattern: 'Invoicing {{amount}} for service {{memo}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentMint: {
					type: 'string',
					description: 'The agent token mint registered with PumpAgent',
				},
				currencyMint: {
					type: 'string',
					description: 'Currency mint (USDC, SOL wrapper, etc.)',
				},
				amount: {
					type: 'string',
					description: 'Amount in base units (string-encoded bigint)',
				},
				memo: { type: 'string', description: 'Invoice memo / nonce (uint)' },
				durationSeconds: { type: 'number', description: 'Validity window (default 600)' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['agentMint', 'currencyMint', 'amount', 'memo'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const duration = args.durationSeconds ?? 600;
			const { pay, web3 } = await loadAgentPayments();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const agentMint = new web3.PublicKey(args.agentMint);
			const currencyMint = new web3.PublicKey(args.currencyMint);
			const env = network === 'devnet' ? 'devnet' : 'mainnet-beta';

			const agent = new pay.PumpAgent(agentMint, env, connection);
			const now = Math.floor(Date.now() / 1000);

			const ixs = await agent.buildAcceptPaymentInstructions({
				user: pubkey,
				currencyMint,
				amount: args.amount,
				memo: args.memo,
				startTime: now,
				endTime: now + duration,
			});

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: ixs,
			});
			return {
				success: true,
				output: `Payment of ${args.amount} accepted. Memo ${args.memo}.`,
				sentiment: 0.7,
				data: {
					signature: sig,
					agentMint: args.agentMint,
					currencyMint: args.currencyMint,
					amount: args.amount,
					memo: args.memo,
					network,
				},
			};
		},
	});

	// ── pumpfun-verify-payment ────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-verify-payment',
		description:
			'Verify that a pump.fun agent payment invoice was settled on-chain. Returns verified:true/false. No wallet required.',
		instruction:
			'Calls PumpAgent.validateInvoicePayment. Queries Pump HTTP API with RPC fallback. All seven invoice fields must match exactly.',
		animationHint: 'inspect',
		voicePattern: 'Verifying invoice {{memo}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentMint: { type: 'string', description: 'The agent token mint' },
				user: { type: 'string', description: 'Payer wallet address (base58)' },
				currencyMint: { type: 'string', description: 'Currency mint (USDC, wSOL, etc.)' },
				amount: { type: 'number', description: 'Amount in base units (6 decimals USDC, 9 for wSOL)' },
				memo: { type: 'number', description: 'Invoice memo / nonce (uint)' },
				startTime: { type: 'number', description: 'Invoice validity window start (Unix seconds)' },
				endTime: { type: 'number', description: 'Invoice validity window end (Unix seconds)' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['agentMint', 'user', 'currencyMint', 'amount', 'memo', 'startTime', 'endTime'],
		},
		handler: async (args, _ctx) => {
			if (!(args.amount > 0)) {
				return { success: false, output: 'amount must be > 0', sentiment: -0.2 };
			}
			if (args.endTime <= args.startTime) {
				return { success: false, output: 'endTime must be after startTime', sentiment: -0.2 };
			}
			const network = args.network || DEFAULT_NETWORK;
			const { pay, web3 } = await loadAgentPayments();
			const connection = getConnection(web3, network);
			const agentMint = new web3.PublicKey(args.agentMint);
			const env = network === 'devnet' ? 'devnet' : 'mainnet';
			const agent = new pay.PumpAgent(agentMint, env, connection);
			const verified = await agent.validateInvoicePayment({
				user: new web3.PublicKey(args.user),
				currencyMint: new web3.PublicKey(args.currencyMint),
				amount: args.amount,
				memo: args.memo,
				startTime: args.startTime,
				endTime: args.endTime,
			});
			return {
				success: true,
				output: verified
					? `Invoice ${args.memo} verified — payment confirmed.`
					: `Invoice ${args.memo} not confirmed yet.`,
				sentiment: verified ? 0.7 : 0.0,
				data: {
					verified,
					memo: args.memo,
					agentMint: args.agentMint,
					network,
				},
			};
		},
	});

	// ── kol.walletPnl ────────────────────────────────────────────────────────
	skills.register({
		name: 'kol.walletPnl',
		description: 'Compute realized + unrealized P&L for a Solana wallet over a time window.',
		instruction: 'FIFO cost-basis P&L. Returns realizedUsd, unrealizedUsd, totalUsd, winRate, openPositions.',
		animationHint: 'inspect',
		voicePattern: 'Checking P&L for {{wallet}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				wallet: { type: 'string', description: 'Solana wallet address (base58)' },
				window: {
					type: 'string',
					enum: ['24h', '7d', '30d', 'all'],
					description: 'Time window (default 7d)',
				},
			},
			required: ['wallet'],
		},
		handler: async (args, _ctx) => {
			const pnl = await getWalletPnl({ wallet: args.wallet, window: args.window ?? '7d' });
			const sign = pnl.totalUsd >= 0 ? '+' : '';
			return {
				success: true,
				output: `Wallet ${args.wallet.slice(0, 8)}… P&L (${pnl.window}): ${sign}$${pnl.totalUsd.toFixed(2)} total (realized ${sign}$${pnl.realizedUsd.toFixed(2)}, unrealized $${pnl.unrealizedUsd.toFixed(2)}). Win rate: ${(pnl.winRate * 100).toFixed(0)}% over ${pnl.trades} trades.`,
				sentiment: pnl.totalUsd > 0 ? 0.6 : pnl.totalUsd < 0 ? -0.2 : 0.1,
				data: pnl,
			};
		},
	});

	// ── pumpfun-invoice-pda ───────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-invoice-pda',
		description:
			'Derive the deterministic on-chain Invoice ID PDA. Use before building a payment tx to pre-check duplicate invoices.',
		instruction:
			'Calls getInvoiceIdPDA from @pump-fun/agent-payments-sdk. Pure offline computation — no wallet or network call.',
		animationHint: 'inspect',
		voicePattern: 'Deriving invoice PDA…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentMint: { type: 'string', description: 'The agent token mint (tokenMint)' },
				currencyMint: { type: 'string', description: 'Currency mint' },
				amount: { type: 'number' },
				memo: { type: 'number' },
				startTime: { type: 'number', description: 'Unix seconds' },
				endTime: { type: 'number', description: 'Unix seconds' },
			},
			required: ['agentMint', 'currencyMint', 'amount', 'memo', 'startTime', 'endTime'],
		},
		handler: async (args, _ctx) => {
			const { pay, web3 } = await loadAgentPayments();
			const [pda, bump] = pay.getInvoiceIdPDA(
				new web3.PublicKey(args.agentMint),
				new web3.PublicKey(args.currencyMint),
				args.amount,
				args.memo,
				args.startTime,
				args.endTime,
			);
			return {
				success: true,
				output: `Invoice PDA: ${pda.toBase58()} (bump ${bump}).`,
				sentiment: 0.1,
				data: {
					pda: pda.toBase58(),
					bump,
					agentMint: args.agentMint,
				},
			};
		},
	});

	// ── pumpfun-list-claims ───────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-list-claims',
		description:
			'List recent pump.fun fee-claim events for a specific creator wallet. Returns signature, mint, lamports, and timestamp for each claim.',
		instruction: 'Read-only. Polls Solana RPC directly — no indexer needed.',
		animationHint: 'think',
		voicePattern: 'Fetching claims for {{creator}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				creator: { type: 'string', description: 'Creator wallet address (base58)' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['creator'],
		},
		handler: async (args, _ctx) => {
			if (!args?.creator) {
				return { success: false, output: 'creator wallet required', sentiment: -0.2 };
			}
			const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
			try {
				const claims = await listRecentClaims({
					creator: args.creator,
					limit,
					network: args.network || DEFAULT_NETWORK,
				});
				return {
					success: true,
					output: claims.length
						? `${claims.length} recent claim${claims.length === 1 ? '' : 's'} for ${args.creator.slice(0, 8)}…\n` +
							claims
								.map((c) => `  ${c.signature.slice(0, 8)}… — ${(c.lamports / 1e9).toFixed(4)} SOL`)
								.join('\n')
						: `No recent claims found for ${args.creator.slice(0, 8)}…`,
					sentiment: claims.length ? 0.3 : 0,
					data: { claims },
				};
			} catch (err) {
				return {
					success: false,
					output: `Could not fetch claims: ${err.message}`,
					sentiment: -0.3,
				};
			}
		},
	});

	// ── pumpfun.vanityMint ────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun.vanityMint',
		description:
			'Generate a Solana keypair whose address matches a vanity suffix/prefix. Returns { publicKey, secretKey: base58, attempts, ms }. Caller must save the secret key — it is never stored.',
		instruction:
			'Searches for a Solana address ending/starting with the requested pattern. May take seconds to minutes depending on length.',
		animationHint: 'gesture',
		voicePattern: 'Searching for a vanity address ending in {{suffix}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				suffix: { type: 'string', description: 'Desired address suffix (case-insensitive by default)' },
				prefix: { type: 'string', description: 'Desired address prefix (case-insensitive by default)' },
				caseSensitive: { type: 'boolean', default: false },
				maxAttempts: { type: 'integer', default: 5000000 },
			},
		},
		handler: async (args, _ctx) => {
			const { generateVanityKey } = await import('./pump/vanity-keygen.js');
			const bs58 = (await import('bs58')).default;

			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), 58_000);
			let result;
			try {
				result = await generateVanityKey({
					suffix: args.suffix || '',
					prefix: args.prefix || '',
					caseSensitive: args.caseSensitive ?? false,
					maxAttempts: args.maxAttempts ?? 5_000_000,
					signal: ac.signal,
				});
			} finally {
				clearTimeout(timer);
			}

			if (!result) {
				return {
					success: false,
					output: 'No matching address found within the attempt limit.',
					sentiment: -0.2,
				};
			}
			return {
				success: true,
				output: `Found vanity address: ${result.publicKey} (${result.attempts} attempts, ${result.ms} ms)`,
				sentiment: 0.8,
				data: {
					publicKey: result.publicKey,
					secretKey: bs58.encode(result.secretKey),
					attempts: result.attempts,
					ms: result.ms,
				},
			};
		},
	});

	// ── kol.leaderboard ──────────────────────────────────────────────────────
	skills.register({
		name: 'kol.leaderboard',
		description: 'Show the top KOL traders ranked by P&L. Returns wallet, pnlUsd, winRate, trades, rank.',
		instruction: 'Fetch the KOL leaderboard for a given time window and limit. No wallet required.',
		animationHint: 'inspect',
		voicePattern: 'Fetching top KOLs for {{window}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				window: { type: 'string', enum: ['24h', '7d', '30d'], description: 'Time window (default 7d)' },
				limit: { type: 'number', description: 'Max entries to return, 1–100 (default 25)' },
			},
		},
		handler: async (args, _ctx) => {
			const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
			const params = new URLSearchParams({
				window: args.window || '7d',
				limit: String(Math.min(Math.max(1, Math.floor(Number(args.limit) || 25)), 100)),
			});
			const res = await fetch(`${origin}/api/kol/leaderboard?${params}`);
			const body = await res.json();
			if (!res.ok) {
				return {
					success: false,
					output: body.error_description || body.error || 'leaderboard fetch failed',
					sentiment: -0.1,
				};
			}
			const items = body.items || [];
			const top3 = items.slice(0, 3).map((e) =>
				`#${e.rank} ${e.wallet.slice(0, 8)}… $${e.pnlUsd.toLocaleString()} (${(e.winRate * 100).toFixed(0)}% wr)`
			).join(', ');
			return {
				success: true,
				output: items.length
					? `Top ${items.length} KOLs (${args.window || '7d'}): ${top3}${items.length > 3 ? '…' : ''}`
					: 'No leaderboard data available.',
				sentiment: 0.3,
				data: { items },
			};
		},
	});

	// ── social.cashtagSentiment ───────────────────────────────────────────────
	skills.register({
		name: 'social.cashtagSentiment',
		description:
			'Score sentiment for a batch of cashtag posts. Accepts posts as { id?, ts?, text, author? }[] and returns a digest with score (-1..1), % breakdown, and examples.',
		instruction:
			'Runs a deterministic lexicon-based sentiment analysis on social posts about a cashtag. No external API required.',
		animationHint: 'inspect',
		voicePattern: 'Analyzing sentiment…',
		mcpExposed: false,
		inputSchema: {
			type: 'object',
			properties: {
				posts: {
					type: 'array',
					description: 'Array of post objects, each with at minimum a `text` field.',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							ts: { type: 'string' },
							text: { type: 'string' },
							author: { type: 'string' },
						},
						required: ['text'],
					},
				},
			},
			required: ['posts'],
		},
		handler: async (args, _ctx) => {
			const { scoreSentiment } = await import('./social/sentiment.js');
			const result = scoreSentiment(args.posts || []);
			const label =
				result.score > 0.2 ? 'bullish' : result.score < -0.2 ? 'bearish' : 'neutral';
			return {
				success: true,
				output: `Sentiment: ${label} (score ${result.score}, ${result.count} posts — ${result.posPct}% positive, ${result.negPct}% negative, ${result.neuPct}% neutral).`,
				sentiment: result.score,
				data: result,
			};
		},
	});

	// ── solana.resolveSns ─────────────────────────────────────────────────────
	skills.register({
		name: 'solana.resolveSns',
		description: 'Resolve a .sol Solana Name Service domain to its owner wallet address.',
		instruction: 'Forward SNS lookup. Read-only. Returns the owner public key for a .sol name.',
		animationHint: 'inspect',
		voicePattern: 'Resolving {{name}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: '.sol domain name, e.g. "bonfida.sol"' },
			},
			required: ['name'],
		},
		handler: async (args, _ctx) => {
			const address = await resolveSnsName(args.name);
			if (!address) {
				return {
					success: false,
					output: `Could not resolve "${args.name}". Domain may not exist.`,
					sentiment: -0.1,
				};
			}
			return {
				success: true,
				output: `${args.name} → ${address}`,
				sentiment: 0.4,
				data: { name: args.name, address },
			};
		},
	});

	// ── solana.reverseSns ─────────────────────────────────────────────────────
	skills.register({
		name: 'solana.reverseSns',
		description: 'Reverse-lookup a Solana wallet address to its primary .sol domain name.',
		instruction: 'Reverse SNS lookup via the primary/favourite domain. Read-only.',
		animationHint: 'inspect',
		voicePattern: 'Reverse-looking up {{address}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				address: { type: 'string', description: 'Base58 Solana wallet address' },
			},
			required: ['address'],
		},
		handler: async (args, _ctx) => {
			const name = await reverseLookupAddress(args.address);
			if (!name) {
				return {
					success: false,
					output: `No .sol domain found for ${args.address.slice(0, 8)}…`,
					sentiment: -0.1,
				};
			}
			return {
				success: true,
				output: `${args.address.slice(0, 8)}… → ${name}`,
				sentiment: 0.4,
				data: { address: args.address, name },
			};
		},
	});

	// ── pumpfun.quoteSwap ─────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun.quoteSwap',
		description: 'Get a read-only price quote for a pump.fun AMM swap. No signing or tx sending.',
		instruction: 'Quote only — safe during demos. One of inputMint/outputMint must be wSOL.',
		animationHint: 'inspect',
		voicePattern: 'Quoting swap of {{amountIn}} {{inputMint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				inputMint: { type: 'string', description: 'Input token mint (base58). wSOL = So11111111111111111111111111111111111111112' },
				outputMint: { type: 'string', description: 'Output token mint (base58).' },
				amountIn: { type: 'number', description: 'Input amount in raw base units (lamports for SOL).' },
				slippageBps: { type: 'number', description: 'Slippage tolerance in basis points (default 100 = 1%).' },
			},
			required: ['inputMint', 'outputMint', 'amountIn'],
		},
		handler: async (args, _ctx) => {
			const result = await quoteSwap({
				inputMint: args.inputMint,
				outputMint: args.outputMint,
				amountIn: args.amountIn,
				slippageBps: args.slippageBps,
			});
			return {
				success: true,
				output: `Quote: ${result.amountOut} out for ${args.amountIn} in. Impact: ${result.priceImpactBps} bps.`,
				sentiment: 0.1,
				data: result,
			};
		},
	});

	// ── social.xPostImpact ────────────────────────────────────────────────────
	skills.register({
		name: 'social.xPostImpact',
		description:
			'Correlate an X post to a memecoin price impact. Returns post metadata, price before/after, and delta %.',
		instruction: 'Fetch oEmbed metadata for an X post and compute price delta in a ±windowMin window.',
		animationHint: 'inspect',
		voicePattern: 'Analyzing price impact of that post…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				postUrl: {
					type: 'string',
					description: 'X post URL (e.g. https://x.com/user/status/123)',
				},
				mint: { type: 'string', description: 'Solana token mint address (base58)' },
				windowMin: {
					type: 'integer',
					default: 30,
					description: '±window in minutes around the post time',
				},
			},
			required: ['postUrl', 'mint'],
		},
		handler: async (args, _ctx) => {
			let result;
			try {
				result = await correlateXPost({
					postUrl: args.postUrl,
					mint: args.mint,
					windowMin: args.windowMin ?? 30,
				});
			} catch (err) {
				return { success: false, output: err.message, sentiment: -0.2 };
			}
			const delta = result.deltaPct;
			const sign = delta != null && delta > 0 ? '+' : '';
			const deltaStr = delta != null ? `${sign}${delta.toFixed(2)}%` : 'n/a';
			const who = result.post?.author ?? 'unknown';
			const snippet = result.post?.text?.slice(0, 80) ?? '(post unavailable)';
			return {
				success: true,
				output: `@${who}: "${snippet}" → ${deltaStr} price change.`,
				sentiment: delta != null ? Math.max(-1, Math.min(1, delta / 20)) : 0,
				data: result,
			};
		},
	});

	// ── pumpfun-first-claims ──────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-first-claims',
		description:
			'List creators making their first-ever pump.fun fee claim — a cash-out signal.',
		instruction:
			'Returns first-time claimers in the requested window. Read-only; no wallet needed.',
		animationHint: 'curiosity',
		voicePattern: 'Scanning for first-time fee claims in the last {{sinceMinutes}} minutes…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				sinceMinutes: {
					type: 'integer',
					minimum: 1,
					maximum: 1440,
					default: 60,
					description: 'How far back to look (minutes)',
				},
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
			},
		},
		handler: async (args) => {
			const sinceMinutes = Math.max(1, Math.min(1440, Number(args?.sinceMinutes) || 60));
			const limit = Math.min(50, Math.max(1, Number(args?.limit) || 20));
			try {
				const r = await fetch(
					`/api/pump/first-claims?sinceMinutes=${sinceMinutes}&limit=${limit}`,
					{ credentials: 'include' },
				);
				if (!r.ok) throw new Error(`status ${r.status}`);
				const data = await r.json();
				const items = data?.items ?? [];
				const summary = items.length
					? `${items.length} first-time claim${items.length === 1 ? '' : 's'} in the last ${sinceMinutes} min:\n` +
					  items
							.map(
								(c) =>
									`${c.creator.slice(0, 8)}… ${(c.lamports / 1e9).toFixed(3)} SOL${c.mint ? ` (${c.mint.slice(0, 8)}…)` : ''}`,
							)
							.join('\n')
					: `No first-time claims in the last ${sinceMinutes} minutes.`;
				return {
					success: true,
					output: summary,
					sentiment: items.length > 0 ? 0.6 : 0.0,
					data: { items },
				};
			} catch (err) {
				return {
					success: false,
					output: `Could not fetch first claims: ${err.message}`,
					sentiment: -0.3,
				};
			}
		},
	});

}
