/**
 * Agent Payments Skills
 * ---------------------
 * Full lifecycle skills for on-chain agent payments via @pump-fun/agent-payments-sdk.
 * Extends the basic accept/verify skills in agent-skills-pumpfun.js with:
 *
 *   agent-payments-register        — register agent on-chain (one-time setup)
 *   agent-payments-balances        — read vault balances for a currency
 *   agent-payments-distribute      — split payment vault → buyback + withdraw
 *   agent-payments-buyback         — trigger buyback swap + burn
 *   agent-payments-withdraw        — pull funds from withdraw vault
 *   agent-payments-update-buyback  — change buyback BPS split
 *   agent-payments-accept-v2       — accept payment (v2, USDC or SOL)
 *   agent-payments-check-whitelist — check if USDC is live on pump.fun v2
 *   agent-payments-accept-evm      — accept EVM-side payment (EvmAgentOffline)
 *   agent-payments-verify-evm      — verify EVM invoice paid on-chain
 *
 * All Solana skills use the injected browser wallet (Phantom/Backpack/Solflare).
 * EVM skills return unsigned tx bundles for the user's EVM wallet to sign.
 */

import { detectSolanaWallet, SOLANA_RPC } from './erc8004/solana-deploy.js';

const DEFAULT_NETWORK = 'mainnet';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ── loaders ──────────────────────────────────────────────────────────────────

async function loadPayments() {
	const [pay, web3, BN] = await Promise.all([
		import('@pump-fun/agent-payments-sdk'),
		import('@solana/web3.js'),
		import('bn.js').then((m) => m.default || m),
	]);
	return { pay, web3, BN };
}

async function loadPumpSdk() {
	const [pump, web3] = await Promise.all([
		import('@pump-fun/pump-sdk'),
		import('@solana/web3.js'),
	]);
	return { pump, web3 };
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
	if (!pubkey) throw new Error('Could not read wallet address.');
	return { wallet, pubkey };
}

async function sendIxs({ web3, connection, wallet, payer, instructions, extraSigners = [] }) {
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
	const msg = new web3.TransactionMessage({
		payerKey: payer,
		recentBlockhash: blockhash,
		instructions,
	}).compileToV0Message();
	const tx = new web3.VersionedTransaction(msg);
	if (extraSigners.length) tx.sign(extraSigners);
	const signed = await wallet.signTransaction(tx);
	const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
	await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
	return sig;
}

// ── skill registration ────────────────────────────────────────────────────────

export function registerAgentPaymentSkills(skills) {

	// ── agent-payments-register ──────────────────────────────────────────────
	skills.register({
		name: 'agent-payments-register',
		description: 'Register this agent on-chain with the pump agent payments program. One-time setup. Sets authority and buyback BPS.',
		instruction: 'Calls agentInitialize. Authority defaults to connected wallet. buybackBps is 0–10000.',
		animationHint: 'gesture',
		voicePattern: 'Registering agent {{agentMint}} on-chain…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentMint: { type: 'string', description: 'Agent token mint (base58)' },
				agentAuthority: { type: 'string', description: 'Authority pubkey (defaults to connected wallet)' },
				buybackBps: { type: 'number', description: 'Buyback basis points 0–10000 (default 5000)' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['agentMint'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { pay, web3 } = await loadPayments();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);
			const mint = new web3.PublicKey(args.agentMint);
			const authority = args.agentAuthority ? new web3.PublicKey(args.agentAuthority) : pubkey;
			const agent = pay.PumpAgentOffline.load(mint, connection);
			const ix = await agent.create({
				authority: pubkey,
				mint,
				agentAuthority: authority,
				buybackBps: args.buybackBps ?? 5000,
			});
			const sig = await sendIxs({ web3, connection, wallet, payer: pubkey, instructions: [ix] });
			return {
				success: true,
				output: `Agent ${args.agentMint.slice(0, 8)}… registered on-chain.`,
				sentiment: 0.8,
				data: { signature: sig, agentMint: args.agentMint, network },
			};
		},
	});

	// ── agent-payments-balances ──────────────────────────────────────────────
	skills.register({
		name: 'agent-payments-balances',
		description: 'Read the three vault balances (payment, buyback, withdraw) for an agent and currency. No wallet required.',
		instruction: 'Calls PumpAgent.getBalances. Returns paymentVault, buybackVault, withdrawVault balances.',
		animationHint: 'inspect',
		voicePattern: 'Checking balances for {{agentMint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentMint: { type: 'string', description: 'Agent token mint' },
				currencyMint: { type: 'string', description: `Currency mint (default USDC: ${USDC_MINT})` },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['agentMint'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { pay, web3 } = await loadPayments();
			const connection = getConnection(web3, network);
			const mint = new web3.PublicKey(args.agentMint);
			const currency = new web3.PublicKey(args.currencyMint || USDC_MINT);
			const agent = new pay.PumpAgent(mint, connection);
			const balances = await agent.getBalances(currency);
			const fmt = (v) => (Number(v) / 1e6).toFixed(6);
			return {
				success: true,
				output: `Payment: ${fmt(balances.paymentVault.balance)} | Buyback: ${fmt(balances.buybackVault.balance)} | Withdraw: ${fmt(balances.withdrawVault.balance)}`,
				sentiment: 0.1,
				data: {
					paymentVault: balances.paymentVault.address.toBase58(),
					paymentBalance: balances.paymentVault.balance.toString(),
					buybackVault: balances.buybackVault.address.toBase58(),
					buybackBalance: balances.buybackVault.balance.toString(),
					withdrawVault: balances.withdrawVault.address.toBase58(),
					withdrawBalance: balances.withdrawVault.balance.toString(),
				},
			};
		},
	});

	// ── agent-payments-distribute ────────────────────────────────────────────
	skills.register({
		name: 'agent-payments-distribute',
		description: 'Distribute accumulated payments — splits payment vault into buyback vault and withdraw vault per the on-chain BPS config. Permissionless.',
		instruction: 'Calls agentDistributePayments. Anyone can call this.',
		animationHint: 'gesture',
		voicePattern: 'Distributing payments for {{agentMint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentMint: { type: 'string' },
				currencyMint: { type: 'string', description: `Currency mint (default USDC)` },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['agentMint'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { pay, web3 } = await loadPayments();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);
			const mint = new web3.PublicKey(args.agentMint);
			const currency = new web3.PublicKey(args.currencyMint || USDC_MINT);
			const agent = pay.PumpAgentOffline.load(mint, connection);
			const ix = await agent.distributePayments({ user: pubkey, currencyMint: currency });
			const sig = await sendIxs({ web3, connection, wallet, payer: pubkey, instructions: [ix] });
			return {
				success: true,
				output: `Payments distributed for ${args.agentMint.slice(0, 8)}…`,
				sentiment: 0.6,
				data: { signature: sig, agentMint: args.agentMint, currencyMint: args.currencyMint || USDC_MINT, network },
			};
		},
	});

	// ── agent-payments-withdraw ──────────────────────────────────────────────
	skills.register({
		name: 'agent-payments-withdraw',
		description: 'Withdraw accumulated funds from the withdraw vault to a receiver ATA. Caller must be agent authority.',
		instruction: 'Calls agentWithdraw. Receiver defaults to connected wallet ATA.',
		animationHint: 'gesture',
		voicePattern: 'Withdrawing funds for {{agentMint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentMint: { type: 'string' },
				currencyMint: { type: 'string' },
				receiverAta: { type: 'string', description: 'Receiver ATA (defaults to connected wallet ATA)' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['agentMint', 'currencyMint'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { pay, web3 } = await loadPayments();
			const spl = await import('@solana/spl-token');
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);
			const mint = new web3.PublicKey(args.agentMint);
			const currency = new web3.PublicKey(args.currencyMint);
			const receiverAta = args.receiverAta
				? new web3.PublicKey(args.receiverAta)
				: spl.getAssociatedTokenAddressSync(currency, pubkey);
			const agent = pay.PumpAgentOffline.load(mint, connection);
			const ix = await agent.withdraw({ authority: pubkey, currencyMint: currency, receiverAta });
			const sig = await sendIxs({ web3, connection, wallet, payer: pubkey, instructions: [ix] });
			return {
				success: true,
				output: `Withdrawal complete. Tx: ${sig.slice(0, 12)}…`,
				sentiment: 0.8,
				data: { signature: sig, agentMint: args.agentMint, currencyMint: args.currencyMint, network },
			};
		},
	});

	// ── agent-payments-update-buyback ────────────────────────────────────────
	skills.register({
		name: 'agent-payments-update-buyback',
		description: 'Update the buyback BPS split for an agent. Authority only.',
		instruction: 'Calls agentUpdateBuybackBps. buybackBps 0–10000.',
		animationHint: 'gesture',
		voicePattern: 'Updating buyback to {{buybackBps}} BPS…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentMint: { type: 'string' },
				buybackBps: { type: 'number', minimum: 0, maximum: 10000 },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['agentMint', 'buybackBps'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { pay, web3 } = await loadPayments();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);
			const mint = new web3.PublicKey(args.agentMint);
			const agent = new pay.PumpAgent(mint, connection);
			const ix = await agent.updateBuybackBps({ authority: pubkey, buybackBps: args.buybackBps });
			const sig = await sendIxs({ web3, connection, wallet, payer: pubkey, instructions: [ix] });
			return {
				success: true,
				output: `Buyback BPS updated to ${args.buybackBps}.`,
				sentiment: 0.4,
				data: { signature: sig, buybackBps: args.buybackBps, network },
			};
		},
	});

	// ── agent-payments-accept-v2 ─────────────────────────────────────────────
	skills.register({
		name: 'agent-payments-accept-v2',
		description: 'Accept a payment via the v2 bonding curve flow. Supports USDC and SOL quote mints.',
		instruction: 'Uses PumpTradeClient for v2 quote routing. Defaults to USDC when available, SOL otherwise.',
		animationHint: 'gesture',
		voicePattern: 'Accepting v2 payment of {{amount}} {{currencySymbol}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentMint: { type: 'string', description: 'Agent token mint' },
				currencyMint: { type: 'string', description: `Quote mint — USDC (${USDC_MINT}) or wSOL` },
				amount: { type: 'string', description: 'Amount in base units (6 dec for USDC, 9 for SOL)' },
				memo: { type: 'string', description: 'Invoice memo / nonce' },
				durationSeconds: { type: 'number', description: 'Validity window (default 600s)' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['agentMint', 'amount', 'memo'],
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { pay, web3, BN } = await loadPayments();
			const { wallet, pubkey } = await requireWallet();
			const connection = getConnection(web3, network);
			const mint = new web3.PublicKey(args.agentMint);
			const currency = new web3.PublicKey(args.currencyMint || USDC_MINT);
			const duration = args.durationSeconds ?? 600;
			const now = Math.floor(Date.now() / 1000);
			const agent = pay.PumpAgentOffline.load(mint, connection);
			const ixs = await agent.acceptPaymentSimple({
				user: pubkey,
				userTokenAccount: pubkey,
				currencyMint: currency,
				amount: BigInt(args.amount),
				memo: BigInt(args.memo),
				startTime: BigInt(now),
				endTime: BigInt(now + duration),
			});
			const sig = await sendIxs({ web3, connection, wallet, payer: pubkey, instructions: [ixs] });
			return {
				success: true,
				output: `v2 payment of ${args.amount} accepted. Tx: ${sig.slice(0, 12)}…`,
				sentiment: 0.8,
				data: { signature: sig, agentMint: args.agentMint, currencyMint: args.currencyMint || USDC_MINT, amount: args.amount, memo: args.memo, network },
			};
		},
	});

	// ── agent-payments-check-whitelist ───────────────────────────────────────
	skills.register({
		name: 'agent-payments-check-whitelist',
		description: 'Check if USDC is live on pump.fun v2 bonding curves by reading the Global whitelist.',
		instruction: 'Reads Global PDA whitelistedQuoteMints. Returns isUsdcLive boolean.',
		animationHint: 'inspect',
		voicePattern: 'Checking USDC whitelist status on pump.fun…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
		},
		handler: async (args, _ctx) => {
			const network = args.network || DEFAULT_NETWORK;
			const { pump, web3 } = await loadPumpSdk();
			const connection = getConnection(web3, network);
			const global = await new pump.OnlinePumpSdk(connection).fetchGlobal();
			const mints = (global.whitelistedQuoteMints || []).map((k) => k.toBase58?.() ?? k.toString());
			const isUsdcLive = mints.includes(USDC_MINT);
			return {
				success: true,
				output: isUsdcLive
					? `USDC is LIVE on pump.fun v2. You can create USDC-quoted coins now.`
					: `USDC not yet whitelisted. Current whitelist: ${mints.join(', ')}`,
				sentiment: isUsdcLive ? 0.9 : 0.0,
				data: { isUsdcLive, whitelistedQuoteMints: mints, createV2Enabled: global.createV2Enabled },
			};
		},
	});

	// ── agent-payments-accept-evm ────────────────────────────────────────────
	skills.register({
		name: 'agent-payments-accept-evm',
		description: 'Build an EVM accept-payment transaction bundle for the agent payments contract. Returns unsigned txs for the user\'s EVM wallet.',
		instruction: 'Uses EvmAgentOffline. Returns approval (if ERC-20) + main tx. User must sign and submit.',
		animationHint: 'gesture',
		voicePattern: 'Building EVM payment for {{agentToken}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentToken: { type: 'string', description: 'EVM agent token address (0x…)' },
				chainId: { type: 'number', description: 'Chain ID — 1 Ethereum, 8453 Base, 42161 Arbitrum, 137 Polygon, 56 BSC' },
				currencyToken: { type: 'string', description: 'ERC-20 token address or "native" for ETH/BNB' },
				amount: { type: 'string', description: 'Amount in token smallest unit (bigint string)' },
				payer: { type: 'string', description: 'Payer EVM address (0x…)' },
				windowSeconds: { type: 'number', description: 'Invoice validity window (default 600s)' },
			},
			required: ['agentToken', 'chainId', 'currencyToken', 'amount', 'payer'],
		},
		handler: async (args, _ctx) => {
			const { EvmAgentOffline } = await import('@pump-fun/agent-payments-sdk/evm');
			const agent = new EvmAgentOffline(args.agentToken, args.chainId);
			const { bundle, memo, invoiceId } = agent.buildAcceptPaymentInstructions({
				agentToken: args.agentToken,
				currencyToken: args.currencyToken,
				amount: BigInt(args.amount),
				payer: args.payer,
				windowSeconds: args.windowSeconds ?? 600,
			});
			return {
				success: true,
				output: `EVM payment bundle ready. Invoice ID: ${invoiceId}. Sign approval${bundle.approval ? ' + ' : ' '}then bridge tx.`,
				sentiment: 0.6,
				data: {
					invoiceId,
					memo: memo.toString(),
					approval: bundle.approval ?? null,
					tx: bundle.tx,
					chainId: args.chainId,
				},
			};
		},
	});

	// ── agent-payments-verify-evm ────────────────────────────────────────────
	skills.register({
		name: 'agent-payments-verify-evm',
		description: 'Verify an EVM agent payment invoice was settled on-chain.',
		instruction: 'Uses EvmAgent.validateInvoicePayment. RPC call to the EVM chain.',
		animationHint: 'inspect',
		voicePattern: 'Verifying EVM invoice {{invoiceId}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				agentToken: { type: 'string' },
				chainId: { type: 'number' },
				currencyToken: { type: 'string' },
				amount: { type: 'string' },
				memo: { type: 'string' },
				startTime: { type: 'number' },
				endTime: { type: 'number' },
				payer: { type: 'string', description: 'Optional payer filter' },
			},
			required: ['agentToken', 'chainId', 'currencyToken', 'amount', 'memo', 'startTime', 'endTime'],
		},
		handler: async (args, _ctx) => {
			const { EvmAgent } = await import('@pump-fun/agent-payments-sdk/evm');
			const agent = new EvmAgent(args.agentToken, args.chainId);
			const result = await agent.validateInvoicePayment({
				currencyToken: args.currencyToken,
				amount: BigInt(args.amount),
				memo: BigInt(args.memo),
				startTime: BigInt(args.startTime),
				endTime: BigInt(args.endTime),
				payer: args.payer,
			});
			return {
				success: true,
				output: result.paid
					? `EVM invoice confirmed on-chain. Tx: ${result.txHash?.slice(0, 12) ?? 'N/A'}…`
					: `EVM invoice not yet confirmed.`,
				sentiment: result.paid ? 0.8 : 0.0,
				data: result,
			};
		},
	});
}
