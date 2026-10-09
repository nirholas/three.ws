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
import { grindVanity } from './solana/vanity/grinder.js';
import { THREE_WS_VANITY, hasThreeWsMark } from './solana/vanity/brand.js';
import { quoteSwap } from './pump/pump-swap-quote.js';
import { fetchChannelFeed } from './pump/channel-feed.js';
import { listRecentClaims } from './pump/pumpkit-claims.js';
import { getWalletPnl } from './kol/wallet-pnl.js';
import { resolveSnsName, reverseLookupAddress } from './solana/sns.js';
import { correlateXPost } from './social/x-post-impact.js';

const DEFAULT_NETWORK = 'mainnet';
const DEFAULT_SLIPPAGE_BPS = 500;

// Every @pump-fun SDK builder takes slippage as a PERCENT (`slippage: 1` = 1%):
// pump-sdk pads via `amount * floor(slippage * 10) / 1000`, pump-swap-sdk via
// `1 ± slippage / 100`. Convert user-facing bps accordingly (100 bps -> 1).
function slippagePct(bps) {
	const n = Number(bps);
	return Math.max(0, Math.min(10_000, Number.isFinite(n) ? n : DEFAULT_SLIPPAGE_BPS)) / 100;
}

// base_token_program must match the mint account's owner — Token-2022 for
// create_v2 coins (every coin pump.fun mints today), SPL Token for legacy
// coins (docs/pumpfun-program/docs/instructions/BUY.md #4).
const TOKEN_2022_PROGRAM_B58 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SPL_TOKEN_PROGRAM_B58 = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
async function detectBaseTokenProgram(connection, mint) {
	const info = await connection.getAccountInfo(mint);
	if (!info) throw new Error(`Mint ${mint.toBase58()} not found on this network.`);
	const owner = info.owner.toBase58();
	if (owner !== TOKEN_2022_PROGRAM_B58 && owner !== SPL_TOKEN_PROGRAM_B58) {
		throw new Error(`Mint is owned by unknown token program ${owner} — not a pump.fun coin.`);
	}
	return info.owner;
}

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
		import('@three-ws/agent-payments'),
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
				// Fail closed: a caller-supplied mint must already carry the 3ws mark.
				if (!hasThreeWsMark(mintKeypair.publicKey.toBase58())) {
					return {
						success: false,
						output:
							'Supplied mint does not carry the three.ws "3ws" mark. Grind a marked mint, or omit it to stamp one automatically.',
						sentiment: -0.3,
					};
				}
			} else {
				// Default: grind the three.ws brand mark so every launch leads with 3ws…
				// (~49k attempts, sub-second). The mint secret never leaves the browser.
				const ground = await grindVanity({ ...THREE_WS_VANITY });
				mintKeypair = web3.Keypair.fromSecretKey(ground.secretKey);
			}
			const offline = new pump.PumpSdk();
			let instructions;

			if (args.initialBuySol && args.initialBuySol > 0) {
				const onlineSdk = new pump.OnlinePumpSdk(connection);
				const global = await onlineSdk.fetchGlobal();
				const solLamports = new BN(Math.floor(args.initialBuySol * web3.LAMPORTS_PER_SOL));
				// buy's `amount` arg is the base-token quantity and must be > 0 —
				// derive it from the dev-buy SOL against the fresh-curve reserves.
				const tokenAmount = pump.getBuyTokenAmountFromSolAmount({
					global,
					feeConfig: null,
					mintSupply: null,
					bondingCurve: null,
					amount: solLamports,
				});
				instructions = await offline.createV2AndBuyInstructions({
					global,
					mint: mintKeypair.publicKey,
					name: tokenName,
					symbol,
					uri: args.uri,
					creator: pubkey,
					user: pubkey,
					amount: tokenAmount,
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
	// Bonding-curve buy. Supports both SOL-paired (legacy `buyInstructions`)
	// and USDC-paired v2 coins (`buyV2Instructions`). The route is auto-detected
	// from the on-chain bonding curve's `quoteMint` field — callers can pass
	// either `solAmount` (SOL coins) or `usdcAmount` (USDC coins); for legacy
	// agents that only know about `solAmount`, the server-flow path falls back
	// to inferring the correct field server-side.
	skills.register({
		name: 'pumpfun-buy',
		description: 'Buy a pump.fun token on the bonding curve (SOL- or USDC-paired).',
		instruction: 'Bonding-curve buy. Reverts if the token has graduated — use pumpfun-amm-buy. For USDC-paired v2 coins, pass usdcAmount instead of solAmount.',
		animationHint: 'gesture',
		voicePattern: 'Buying {{solAmount}} SOL of {{mint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				solAmount: { type: 'number', description: 'SOL to spend (SOL-paired coins).' },
				usdcAmount: { type: 'number', description: 'USDC to spend (USDC-paired v2 coins).' },
				quoteMint: { type: 'string', description: 'Optional explicit quote mint. Auto-detected from the on-chain bonding curve when omitted.' },
				slippageBps: { type: 'number' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['mint'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
			const usdcAmount = typeof args.usdcAmount === 'number' ? args.usdcAmount : null;
			const solAmount  = typeof args.solAmount  === 'number' ? args.solAmount  : null;
			if (usdcAmount == null && solAmount == null) {
				return { success: false, output: 'pumpfun-buy requires either solAmount or usdcAmount.', sentiment: -0.2 };
			}

			if (args.serverFlow) {
				const { pubkey: pk } = await requireWallet();
				const body = {
					mint: args.mint,
					network,
					slippage_bps: slippageBps,
					wallet_address: pk.toBase58(),
					...(args.quoteMint ? { quote_mint: args.quoteMint } : {}),
					...(usdcAmount != null ? { usdc_amount: usdcAmount } : { sol: solAmount }),
				};
				const r = await runServerFlow({
					prepPath: '/api/pump/buy-prep',
					body,
					confirmPath: '/api/pump/buy-confirm',
					confirmExtra: (prep) => ({
						mint: args.mint,
						network,
						wallet_address: pk.toBase58(),
						// Record whichever quote asset funded the buy. USDC-paired v2
						// coins have no `sol`, so sending `sol: 0` would 400 at confirm.
						...(usdcAmount != null ? { usdc_amount: usdcAmount } : { sol: solAmount }),
						slippage_bps: slippageBps,
						route: prep.route,
					}),
				});
				const route = r.prep.route;
				const denom = usdcAmount != null ? `${usdcAmount} USDC` : `${solAmount} SOL`;
				return {
					success: true,
					output: `Bought ~${denom} of ${args.mint.slice(0, 8)}… via ${route}.`,
					sentiment: 0.6,
					data: {
						signature: r.signature,
						route,
						mint: args.mint,
						quote_mint: r.prep.quote_mint || null,
						network,
						tracked: r.confirm?.tracked,
					},
				};
			}

			// In-browser path: build, sign, and send the instructions directly.
			const { pump, web3, BN } = await loadCore();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const onlineSdk = new pump.OnlinePumpSdk(connection);
			const offline = new pump.PumpSdk();

			const tokenProgram = await detectBaseTokenProgram(connection, mint);
			const [global, feeConfig, state] = await Promise.all([
				onlineSdk.fetchGlobal(),
				onlineSdk.fetchFeeConfig().catch(() => null),
				onlineSdk.fetchBuyState(mint, pubkey, tokenProgram),
			]);

			// Resolve quoteMint: explicit override > on-chain curve > WSOL fallback.
			const WSOL = new web3.PublicKey('So11111111111111111111111111111111111111112');
			const quoteMintPk = args.quoteMint
				? new web3.PublicKey(args.quoteMint)
				: (state.bondingCurve?.quoteMint || WSOL);
			const isUsdcQuote = !pump.isLegacyQuoteMint(quoteMintPk);

			if (isUsdcQuote && usdcAmount == null) {
				return { success: false, output: 'USDC-paired coin: pass usdcAmount.', sentiment: -0.2 };
			}
			if (!isUsdcQuote && solAmount == null) {
				return { success: false, output: 'SOL-paired coin: pass solAmount.', sentiment: -0.2 };
			}
			const quoteAtomics = isUsdcQuote
				? new BN(Math.round(usdcAmount * 1_000_000))
				: new BN(Math.floor(solAmount * web3.LAMPORTS_PER_SOL));
			// buy_v2's `amount` arg is the base-token quantity to buy (must be > 0);
			// the SDK pads `quoteAmount` into max_quote_cost with percent slippage.
			const expected = pump.getBuyTokenAmountFromSolAmount({
				global,
				feeConfig,
				mintSupply: state.bondingCurve.tokenTotalSupply,
				bondingCurve: state.bondingCurve,
				amount: quoteAtomics,
				quoteMint: quoteMintPk,
			});
			if (!expected.gt(new BN(0))) {
				return { success: false, output: 'Amount too small to buy any tokens.', sentiment: -0.2 };
			}
			// Unified v2 buy for every coin type (SOL/USDC quotes, SPL/Token-2022
			// base mints) per the upstream migration guidance.
			const buyIxs = await offline.buyV2Instructions({
				global,
				bondingCurveAccountInfo: state.bondingCurveAccountInfo,
				bondingCurve: state.bondingCurve,
				associatedUserAccountInfo: state.associatedUserAccountInfo,
				mint,
				user: pubkey,
				amount: expected,
				quoteAmount: quoteAtomics,
				slippage: slippagePct(slippageBps),
				tokenProgram,
			});

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: buyIxs,
			});
			const denom = isUsdcQuote ? `${usdcAmount} USDC` : `${solAmount} SOL`;
			return {
				success: true,
				output: `Bought ${args.mint.slice(0, 8)}… for ${denom}.`,
				sentiment: 0.6,
				data: { signature: sig, mint: args.mint, quote_mint: quoteMintPk.toBase58(), network },
			};
		},
	});

	// ── pumpfun-sell ──────────────────────────────────────────────────────────
	// Bonding-curve sell. Auto-detects the quote mint from the on-chain
	// bonding-curve state and routes through `sellV2Instructions` for USDC-paired
	// v2 coins or the legacy `sellInstructions` for SOL-paired coins.
	skills.register({
		name: 'pumpfun-sell',
		description: 'Sell a pump.fun token back to the bonding curve (SOL- or USDC-paired).',
		instruction: 'Bonding-curve sell. Reverts if graduated — use pumpfun-amm-sell. Quote currency (SOL or USDC) is auto-detected from the coin.',
		animationHint: 'gesture',
		voicePattern: 'Selling {{tokenAmount}} of {{mint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				tokenAmount: { type: 'string', description: 'Base-unit integer string' },
				quoteMint: { type: 'string', description: 'Optional explicit quote mint. Auto-detected from the on-chain bonding curve when omitted.' },
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
						...(args.quoteMint ? { quote_mint: args.quoteMint } : {}),
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

			const { pump, web3, BN, splToken } = await loadCore();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const onlineSdk = new pump.OnlinePumpSdk(connection);
			const offline = new pump.PumpSdk();
			const tokenProgram = await detectBaseTokenProgram(connection, mint);
			const [global, feeConfig, state] = await Promise.all([
				onlineSdk.fetchGlobal(),
				onlineSdk.fetchFeeConfig().catch(() => null),
				onlineSdk.fetchSellState(mint, pubkey, tokenProgram),
			]);

			const tokenAmount = new BN(args.tokenAmount);
			// Expected quote output: the SDK shaves it by the percent slippage to
			// produce a real min_sol_output floor (passing 0 disables protection).
			const expectedSol = pump.getSellSolAmountFromTokenAmount({
				global,
				feeConfig,
				mintSupply: state.bondingCurve.tokenTotalSupply,
				bondingCurve: state.bondingCurve,
				amount: tokenAmount,
			});

			// Resolve the on-chain quote mint (default pubkey = SOL-paired).
			const WSOL = new web3.PublicKey('So11111111111111111111111111111111111111112');
			const quoteMintPk = args.quoteMint
				? new web3.PublicKey(args.quoteMint)
				: (state.bondingCurve?.quoteMint || WSOL);
			const isUsdcQuote = !pump.isLegacyQuoteMint(quoteMintPk);

			// Unified v2 sell for every coin type. For stable quotes the program
			// pays proceeds into the seller's quote ATA, which sell_v2 does NOT
			// init — create it idempotently first.
			const sellIxs = [];
			if (isUsdcQuote && splToken) {
				const userQuoteAta = splToken.getAssociatedTokenAddressSync(
					quoteMintPk,
					pubkey,
					true,
					splToken.TOKEN_PROGRAM_ID,
				);
				sellIxs.push(
					splToken.createAssociatedTokenAccountIdempotentInstruction(
						pubkey,
						userQuoteAta,
						pubkey,
						quoteMintPk,
						splToken.TOKEN_PROGRAM_ID,
					),
				);
			}
			sellIxs.push(
				...(await offline.sellV2Instructions({
					global,
					bondingCurveAccountInfo: state.bondingCurveAccountInfo,
					bondingCurve: state.bondingCurve,
					mint,
					user: pubkey,
					amount: tokenAmount,
					quoteAmount: expectedSol,
					slippage: slippagePct(slippageBps),
					tokenProgram,
				})),
			);

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
				data: { signature: sig, mint: args.mint, quote_mint: quoteMintPk.toBase58(), network },
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
			const graduated = !!curve.complete;
			// Graduated curves have zero virtual token reserves, which the SDK
			// helper rejects — report the curve's last market cap as null there.
			const marketCap = curve.virtualTokenReserves.isZero()
				? null
				: pump.bondingCurveMarketCap({
						mintSupply: curve.tokenTotalSupply,
						virtualQuoteReserves: curve.virtualQuoteReserves ?? curve.virtualSolReserves,
						virtualTokenReserves: curve.virtualTokenReserves,
					});

			let userBalance = '0';
			let owner = null;
			try {
				const wallet = detectSolanaWallet();
				if (wallet?.publicKey && splToken) {
					owner = wallet.publicKey;
					// Token-2022 coins (create_v2) live at a different ATA than SPL —
					// derive with the mint's real token program.
					const tokenProgram = await detectBaseTokenProgram(connection, mint);
					const ata = splToken.getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
					const acct = await connection.getTokenAccountBalance(ata).catch(() => null);
					userBalance = acct?.value?.amount ?? '0';
				}
			} catch {}

			const marketCapStr = marketCap ? marketCap.toString() : null;
			return {
				success: true,
				output: graduated
					? `Graduated to AMM — price now set by the pool${marketCapStr ? `. Last curve market cap ~${marketCapStr} quote units.` : '.'}`
					: `On bonding curve. Market cap ~${marketCapStr} quote units.`,
				sentiment: graduated ? 0.7 : 0.2,
				data: {
					mint: args.mint,
					marketCap: marketCapStr,
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
			const { amm, web3, BN } = await loadAmm();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const online = new amm.OnlinePumpAmmSdk(connection);
			const offline = new amm.PumpAmmSdk();
			const solLamports = new BN(Math.floor(args.solAmount * web3.LAMPORTS_PER_SOL));

			// canonicalPumpPoolPda returns the pool PublicKey directly (keyed to
			// the wSOL quote — this skill is SOL-denominated).
			const poolKey = amm.canonicalPumpPoolPda(mint);
			const swapState = await online.swapSolanaState(poolKey, pubkey);
			const ixs = await offline.buyQuoteInput(
				swapState,
				solLamports,
				slippagePct(args.slippageBps),
			);

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: ixs,
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
			const { amm, web3, BN } = await loadAmm();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);

			const mint = new web3.PublicKey(args.mint);
			const online = new amm.OnlinePumpAmmSdk(connection);
			const offline = new amm.PumpAmmSdk();
			const tokenAmount = new BN(args.tokenAmount);

			const poolKey = amm.canonicalPumpPoolPda(mint);
			const swapState = await online.swapSolanaState(poolKey, pubkey);
			const ixs = await offline.sellBaseInput(
				swapState,
				tokenAmount,
				slippagePct(args.slippageBps),
			);

			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: ixs,
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
		instruction:
			'Sweeps the fees v3 / PumpSwap v2 trades left on the given coins\' curves and pools, then calls collectCoinCreatorFeeInstructions on OnlinePumpSdk.',
		animationHint: 'celebrate',
		voicePattern: 'Claiming creator fees…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
				mints: {
					type: 'array',
					items: { type: 'string' },
					maxItems: 20,
					description: 'Coins this wallet created. Their creator fees still on the curve or pool are swept in first.',
				},
			},
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { pump, web3 } = await loadCore();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);
			const creator = pubkey.toBase58();
			const { readCreatorFeeBuckets, unsweptCreatorFees, creatorFeeSweepInstructions } = await import(
				'./solana/pump-creator-sweep.js'
			);
			const mints = (Array.isArray(args.mints) ? args.mints : []).filter((m) => typeof m === 'string' && m.length >= 32);
			const legs = mints.length
				? unsweptCreatorFees((await readCreatorFeeBuckets(connection, mints)).values(), creator).filter(
						(l) => l.quoteMint === 'So11111111111111111111111111111111111111112',
					)
				: [];
			const unswept = legs.reduce((sum, l) => sum + l.amount, 0n);

			const onlineSdk = new pump.OnlinePumpSdk(connection);
			const vault = BigInt((await onlineSdk.getCreatorVaultBalanceBothPrograms(pubkey)).toString());
			const total = vault + unswept;
			if (total === 0n) {
				return {
					success: true,
					output: 'No creator fees to claim right now.',
					sentiment: 0.1,
					data: { lamports: '0' },
				};
			}

			const { instructions: sweeps, swept } = await creatorFeeSweepInstructions(connection, { legs, payer: pubkey });
			const claimed = vault + swept.reduce((sum, l) => sum + l.amount, 0n);
			const ixs = await onlineSdk.collectCoinCreatorFeeInstructions(pubkey, pubkey);
			const sig = await sendIxs({
				web3,
				connection,
				wallet,
				payer: pubkey,
				instructions: [...sweeps, ...ixs],
			});
			return {
				success: true,
				output: `Claimed ${claimed.toString()} lamports of creator fees.`,
				sentiment: 0.8,
				data: { signature: sig, lamports: claimed.toString(), swept: swept.length, network },
			};
		},
	});

	// ── pumpfun.channelFeed ───────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun.channelFeed',
		description: 'Fetch recent pump.fun activity (new mints, whale buys, creator claims) plus agent-attributed reputation signals as a digest the LLM can summarize.',
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
					description: 'Comma-separated filter: mint, whale, claim, signal (default: all)',
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

	// ── pumpfun-accept-payment ────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-accept-payment',
		description:
			'Accept a paid invocation of this agent via @three-ws/agent-payments. Splits revenue per the on-chain sharing config.',
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
			const env = network === 'devnet' ? 'devnet' : 'mainnet';

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
			'Calls getInvoiceIdPDA from @three-ws/agent-payments. Pure offline computation — no wallet or network call.',
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
