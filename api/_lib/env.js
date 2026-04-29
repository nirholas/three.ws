// Centralized env access. Lazy by design: missing env vars fail at first use,
// not at module import, so unrelated endpoints (e.g. OAuth discovery) still
// respond when the deployment is partially configured.

function req(name) {
	const v = process.env[name];
	if (!v) throw new Error(`Missing required env var: ${name}`);
	return v;
}

function opt(name, fallback = undefined) {
	return process.env[name] ?? fallback;
}

function trimSlash(s) {
	return s ? s.replace(/\/$/, '') : s;
}

export const env = {
	get APP_ORIGIN() {
		return trimSlash(opt('PUBLIC_APP_ORIGIN', 'https://three.ws/'));
	},

	get DATABASE_URL() {
		return req('DATABASE_URL');
	},

	get S3_ENDPOINT() {
		return trimSlash(req('S3_ENDPOINT'));
	},
	get S3_ACCESS_KEY_ID() {
		return req('S3_ACCESS_KEY_ID');
	},
	get S3_SECRET_ACCESS_KEY() {
		return req('S3_SECRET_ACCESS_KEY');
	},
	get S3_BUCKET() {
		return req('S3_BUCKET');
	},
	get S3_PUBLIC_DOMAIN() {
		return trimSlash(req('S3_PUBLIC_DOMAIN'));
	},

	get UPSTASH_REDIS_REST_URL() {
		return opt('UPSTASH_REDIS_REST_URL');
	},
	get UPSTASH_REDIS_REST_TOKEN() {
		return opt('UPSTASH_REDIS_REST_TOKEN');
	},

	get JWT_SECRET() {
		return req('JWT_SECRET');
	},
	get JWT_KID() {
		return opt('JWT_KID', 'k1');
	},

	get PASSWORD_ROUNDS() {
		return parseInt(opt('PASSWORD_ROUNDS', '11'), 10);
	},

	get ISSUER() {
		return this.APP_ORIGIN;
	},
	get MCP_RESOURCE() {
		return `${this.APP_ORIGIN}/api/mcp`;
	},

	// Avaturn — photo-to-avatar pipeline. Only read when /api/onboarding/avaturn-session
	// is hit; keeping these optional so unrelated endpoints still respond when unset.
	get AVATURN_API_KEY() {
		return opt('AVATURN_API_KEY');
	},
	get AVATURN_API_URL() {
		return trimSlash(opt('AVATURN_API_URL', 'https://api.avaturn.me'));
	},

	// Anthropic API key — used by the we-pay LLM proxy (/api/llm/anthropic).
	// Must be set in production; optional in local dev if the proxy is unused.
	get ANTHROPIC_API_KEY() {
		return req('ANTHROPIC_API_KEY');
	},

	// Etherscan V2 — unified multichain explorer API (one key, all chains).
	// Used by api/cron/erc8004-crawl.js to index ERC-8004 Registered events.
	get ETHERSCAN_API_KEY() {
		return opt('ETHERSCAN_API_KEY');
	},

	// Secret for Vercel Cron Authorization header (crons call with `Bearer $CRON_SECRET`).
	get CRON_SECRET() {
		return opt('CRON_SECRET');
	},

	// Mainnet RPC URL for ENS resolution. Falls back to ethers public default provider.
	// Recommended: set to an Alchemy / Infura URL for reliability.
	get MAINNET_RPC_URL() {
		return opt('MAINNET_RPC_URL');
	},

	// ── ERC-7710 Delegation Relayer ──────────────────────────────────────────
	// Private key of the server-held EOA that pays gas for redeemDelegations.
	// NEVER log this value. Rotate via Vercel env; derive AGENT_RELAYER_ADDRESS
	// from the key using: node -e "require('ethers').Wallet.createRandom().address"
	get AGENT_RELAYER_KEY() {
		return req('AGENT_RELAYER_KEY');
	},

	// Derived: checksummed address of the relayer EOA. Fund with testnet ETH.
	// Optional — can be computed from AGENT_RELAYER_KEY; provided here for ops convenience.
	get AGENT_RELAYER_ADDRESS() {
		return opt('AGENT_RELAYER_ADDRESS');
	},

	// Comma-separated wallet addresses (EVM or Solana) that have admin access.
	// Bootstrap: set to your own wallet address. Can also be promoted via DB is_admin flag.
	get ADMIN_ADDRESSES() {
		const raw = opt('ADMIN_ADDRESSES', '');
		return new Set(raw.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean));
	},

	// Feature flag. Set to "true" to enable POST /api/permissions/redeem.
	// Defaults to false so the endpoint is opt-in per environment.
	get PERMISSIONS_RELAYER_ENABLED() {
		return opt('PERMISSIONS_RELAYER_ENABLED', 'false') === 'true';
	},

	// IPFS pinning provider credentials. Optional — when unset, pin endpoints
	// fall back to a content-hash stub so the rest of the flow still works in
	// dev. Set PINATA_JWT in production for real pins.
	get PINATA_JWT() {
		return opt('PINATA_JWT');
	},

	// Per-chain RPC URLs for on-chain delegation calls.
	// Pattern: RPC_URL_<CHAINID> e.g. RPC_URL_84532 for Base Sepolia.
	// Falls back to public RPC nodes when unset; set Alchemy/Infura URLs for production.
	// ── x402 (HTTP 402 micropayments) ───────────────────────────────────────
	// Per-network payTo wallets that receive USDC for paid /api/mcp calls.
	get X402_PAY_TO_SOLANA() {
		return opt(
			'X402_PAY_TO_SOLANA',
			opt('X402_PAY_TO', 'BUrwd1nK6tFeeJMyzRHDo6AuVbnSfUULfvwq21X93nSN'),
		);
	},
	get X402_PAY_TO_BASE() {
		return opt('X402_PAY_TO_BASE', '0x0C70c0e8453C5667739E41acdF6eC5787B8ff542');
	},
	// USDC asset addresses per network.
	get X402_ASSET_MINT_SOLANA() {
		return opt(
			'X402_ASSET_MINT_SOLANA',
			opt('X402_ASSET_MINT', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
		);
	},
	get X402_ASSET_ADDRESS_BASE() {
		return opt('X402_ASSET_ADDRESS_BASE', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
	},
	// Price per /api/mcp call, in the asset's base units (USDC = 6 decimals; "1000" = 0.001 USDC).
	get X402_MAX_AMOUNT_REQUIRED() {
		return opt('X402_MAX_AMOUNT_REQUIRED', '1000');
	},
	// Per-network facilitators. PayAI for Solana, x402.org reference for Base.
	get X402_FACILITATOR_URL_SOLANA() {
		return trimSlash(
			opt(
				'X402_FACILITATOR_URL_SOLANA',
				opt('X402_FACILITATOR_URL', 'https://facilitator.payai.network'),
			),
		);
	},
	get X402_FACILITATOR_URL_BASE() {
		return trimSlash(opt('X402_FACILITATOR_URL_BASE', 'https://x402.org/facilitator'));
	},
	get X402_FACILITATOR_TOKEN_SOLANA() {
		return opt('X402_FACILITATOR_TOKEN_SOLANA', opt('X402_FACILITATOR_TOKEN'));
	},
	get X402_FACILITATOR_TOKEN_BASE() {
		return opt('X402_FACILITATOR_TOKEN_BASE');
	},

	// zauthx402 SDK — optional telemetry for x402 endpoints. When unset,
	// the SDK is not initialized and request monitoring is skipped.
	get ZAUTH_API_KEY() {
		return opt('ZAUTH_API_KEY');
	},

	// Solana RPC URL used for SNS reads/writes. Falls back to public mainnet RPC.
	get SOLANA_RPC_URL() {
		return opt('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com');
	},

	// Admin key for three.ws chat brand config endpoint. Optional — when unset
	// the POST /api/chat/config endpoint returns 503.
	get CHAT_ADMIN_KEY() {
		return opt('CHAT_ADMIN_KEY');
	},

	// OpenRouter API key used by the server-side chat proxy (/api/chat/proxy).
	// Free-tier models are forwarded without exposing this key to the browser.
	get OPENROUTER_API_KEY() {
		return opt('OPENROUTER_API_KEY');
	},

	getRpcUrl(chainId) {
		return (
			opt(`RPC_URL_${chainId}`) ||
			(chainId === 84532 ? opt('BASE_SEPOLIA_RPC_URL') : null) ||
			(chainId === 11155111 ? opt('SEPOLIA_RPC_URL') : null) ||
			null
		);
	},
};
