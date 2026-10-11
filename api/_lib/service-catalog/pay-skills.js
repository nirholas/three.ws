// pay-skills projection: three.ws paid services as providers in the Solana
// Foundation `pay` registry (github.com/solana-foundation/pay-skills).
//
// `pay` is the Solana Foundation's agentic-payments CLI and MCP server. Its
// public registry is what `pay skills search` and every agent running
// `pay mcp` browse, and an entry there is a PAY.md (frontmatter + prose) plus a
// committed OpenAPI document whose operations carry `x-payment-info`.
//
// What is written here and what is read from elsewhere:
//   - Paths, methods, input schemas and example inputs come from the service
//     catalog descriptors (./services), so a schema change there flows into the
//     listing on the next `npm run build:pay-skills`.
//   - Prices come from the same functions the live 402 challenges quote from:
//     the descriptor's priceAtomics, forge-tiers.js for Forge's three tiers,
//     and pipeline.js for the per-stage pipeline sum.
//   - Summaries, descriptions and a few parameter descriptions are written
//     here, because the registry enforces its own copy rules that our other
//     storefront text does not meet: verb-first operation summaries of 24-64
//     ASCII characters (the summary becomes the reason line on the payer's
//     biometric prompt), no marketing language, and every parameter described.
//
// The registry only admits endpoints that accept USDC or USDT on Solana
// mainnet, so a service whose accepts builder cannot offer Solana is refused
// at build time rather than listed and then failed by the registry's CI probe.
//
// Built into distributions/pay-skills/ by scripts/build-pay-skills.mjs.
// Guarded by tests/pay-skills.test.js.

import { PAID_SERVICES } from './services/index.js';
import { TIERS } from '../forge-tiers.js';
import { STAGE_IDS, priceAtomicsForStage } from '../pipeline.js';
import { FREE_DAILY_LIMIT as FACT_CHECK_FREE_DAILY } from '../../x402/fact-check.js';

export const ORIGIN = 'https://three.ws';
export const OPERATOR = 'three-ws';

// The $THREE mint: the only token this platform uses as a worked example.
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
// A real public three.ws agent (GET /api/agents/public) and a real remixable
// creation (GET /api/remix-feed), so examples resolve against live records.
const EXAMPLE_AGENT_ID = '27a0f649-3b59-4552-bb0b-faf616ac448b';
const EXAMPLE_REMIX_SOURCE = '3abac32f-ced2-4189-b822-d30c96dbc87e';

// Accepts builders whose live 402 offers include Solana (mirrors
// NETWORKS_BY_BUILDER in ./index.js). 'permit2-only' is Base-only.
const SOLANA_BUILDERS = new Set(['standard', 'cdp-bazaar']);

export const PAY_CATEGORIES = Object.freeze([
	'ai_ml', 'cloud', 'compute', 'data', 'devtools', 'finance', 'identity', 'maps',
	'media', 'messaging', 'other', 'productivity', 'search', 'security', 'shopping',
	'storage', 'translation',
]);

// ── Price helpers ────────────────────────────────────────────────────────────

function usd(atomics) {
	const n = Number(atomics) / 1_000_000;
	if (!Number.isFinite(n) || n <= 0) throw new Error(`pay-skills: bad price atomics ${atomics}`);
	return String(Number(n.toFixed(6)));
}

const fixedPrice = (atomics) => ({ mode: 'fixed', currency: 'USD', amount: usd(atomics) });
const dynamicPrice = (minAtomics, maxAtomics) => ({
	mode: 'dynamic',
	currency: 'USD',
	min: usd(minAtomics),
	max: usd(maxAtomics),
});

function forgePrice() {
	const atomics = Object.values(TIERS).map((t) => t.priceUsdcAtomics);
	return dynamicPrice(Math.min(...atomics), Math.max(...atomics));
}

function pipelinePrice() {
	const atomics = STAGE_IDS.map((id) => Number(priceAtomicsForStage(id)));
	return dynamicPrice(Math.min(...atomics), atomics.reduce((a, b) => a + b, 0));
}

// ── Providers ────────────────────────────────────────────────────────────────
//
// Each operation is either `slug` (a paid service in the catalog) or `free`
// (an unpaid companion route an agent needs to finish a paid flow, such as
// polling a job). `params` overrides or fills a parameter's description and
// example; `example` replaces the descriptor's example input wholesale.

export const PAY_PROVIDERS = Object.freeze([
	{
		name: '3d',
		title: 'three.ws 3D',
		category: 'media',
		description:
			'Text-to-3D and image-to-3D generation returning GLB models, plus a 3D asset pipeline: auto-rigging, remeshing, game-ready retopology, geometric stylizing, background removal, model inspection, remixing, and talking avatar bodies.',
		useCase:
			'Use when an agent needs a 3D model, game asset, prop, or character: generate a GLB from a prompt or photos, rig a static mesh for animation, cut a mesh to a poly budget, restyle it, check a GLB before using it, or give an AI agent a 3D avatar body.',
		body: `three.ws is a 3D platform for AI agents. This provider covers the paid 3D
endpoints: generation (text or up to six photos in, textured GLB out), the
asset pipeline that turns any public GLB into a rigged, retopologized, or
restyled one, structural inspection of a GLB before you use it, remixes of
published models with on-chain creator royalties, and \`embody\`, which returns
a rigged, talking avatar plus a one-tag web embed for an agent.

Generation and pipeline calls are asynchronous. The paid response carries a
job token; poll \`GET /api/forge?job=<token>\` (free, no payment) until
\`status\` is \`done\` and read the GLB URL from the result. Draft-tier prompts
often finish inline and return the GLB URL directly.

Every output is a durable HTTPS URL to a binary glTF (GLB) that loads in
Three.js, Babylon.js, Unity, Unreal, Blender, and \`<model-viewer>\`.

## Spend-aware usage

- Generate at the \`draft\` tier while iterating on a prompt, then rerun the
  winner at \`standard\` or \`high\`.
- Chain stages in one \`/api/x402/pipeline\` call instead of paying for each
  stage separately; the 402 quotes the exact sum of the stages requested.
- Run \`/api/x402/model-check\` on a third-party GLB before paying to rig or
  remesh it; it reports triangle counts, materials, and problems first.
- Polling a job is free. Never resubmit a paid generation to check progress.
- Browse remix sources with the free \`GET /api/remix-feed\` before paying for a
  remix, and reuse the returned creation ids.`,
		operations: [
			{
				slug: 'forge',
				summary: 'Generate a 3D model (GLB) from a text prompt or photos',
				description:
					'Generate a textured GLB mesh from one text prompt or up to six reference photos of one object. Tiers: draft (fast, low-poly), standard (default), high (PBR textures). Returns a job token to poll for free.',
				price: forgePrice,
			},
			{
				free: {
					method: 'GET',
					path: '/api/forge',
					operationId: 'forge_job_status',
					params: {
						job: {
							required: true,
							description: 'Job token returned by a paid generation or pipeline call.',
						},
					},
				},
				summary: 'Fetch the status and GLB URL of a 3D generation job',
				description:
					'Poll a generation or pipeline job without payment. Returns status (queued, running, done, failed), per-stage progress for pipelines, and the GLB URL once the job is done.',
			},
			{
				slug: 'pipeline',
				summary: 'Submit a chained 3D job: generate, rig, remesh, stylize',
				description:
					'Run an ordered chain of 3D stages (generate, rig, remesh, gameready, stylize) in one paid call. The 402 quotes the sum of the requested stages. Returns a job token to poll for free.',
				price: pipelinePrice,
				params: {
					options: {
						description:
							'Per-stage options keyed by stage: tier and aspect_ratio for generate, rig_type for rig, remesh settings, gameready topology and poly_budget, stylize style and resolution.',
					},
				},
			},
			{
				slug: 'pipeline-rig',
				summary: 'Convert a static GLB mesh into a rigged, animatable model',
				description:
					'Infer a skeleton for a static GLB and bind it with skin weights so the model can walk, wave, and emote. Returns a durable URL to the rigged GLB.',
				params: {
					rig_type: { description: 'Skeleton to infer: biped (humanoid, the default) or quadruped.' },
				},
			},
			{
				slug: 'pipeline-remesh',
				summary: 'Convert a GLB mesh to a new topology and face count',
				description:
					'Retopologize a GLB as triangles, quads, or low-poly, with repair and decimation to a target face count, and re-bake the texture onto the new mesh. Returns a durable GLB URL.',
				params: {
					remesh_mode: { description: 'Output topology: triangle (default), quad, or lowpoly.' },
					operation: {
						description: 'full (default) remeshes and re-bakes; simplify, repair, or convert run one step only.',
					},
					target_faces: { description: 'Target face count for the output mesh, 1,000 to 500,000.' },
					texture_size: { description: 'Edge length in pixels of the re-baked texture.' },
				},
			},
			{
				slug: 'pipeline-gameready',
				summary: 'Convert a GLB into a game-ready mesh under a poly budget',
				description:
					'Retopologize a GLB to a fixed polygon budget (quad or silhouette-preserving triangles) with PBR textures re-baked onto the new topology, ready for a game engine. Returns a durable GLB URL.',
				params: {
					topology: { description: 'Output topology: quad (default) or tri.' },
					poly_budget: { description: 'Maximum polygon count of the output mesh, 1,000 to 500,000.' },
					texture_size: { description: 'Edge length in pixels of the re-baked PBR textures.' },
				},
			},
			{
				slug: 'pipeline-stylize',
				summary: 'Convert a GLB mesh into voxel, brick, shatter, or low-poly',
				description:
					'Rebuild a GLB geometrically in a voxel, brick, Voronoi-shatter, or faceted low-poly style. The style lives in the mesh, not a shader, so it survives export to any engine.',
				params: {
					style: { description: 'Geometric style: voxel (default), brick, voronoi, or lowpoly.' },
				},
			},
			{
				slug: 'pipeline-rembg',
				summary: 'Remove the background from an image for image-to-3D',
				description:
					'Strip the background from an image and return a transparent PNG, the clean reference view image-to-3D reconstruction needs. Returns a durable PNG URL.',
				params: {
					model: { description: 'Segmentation model to use; rmbg2 (default) suits most objects.' },
				},
			},
			{
				slug: 'model-check',
				summary: 'Analyze a GLB model and return stats and optimization tips',
				description:
					'Fetch a public glTF or GLB and return structural stats (vertices, triangles, materials, textures, animations, extensions) with a prioritized list of optimization recommendations.',
			},
			{
				slug: 'remix-asset',
				summary: 'Create a remix of a published 3D model from an instruction',
				description:
					'Generate a new 3D model from a published remixable source and a plain-language change. Records parent-to-child provenance and routes the creator royalty on-chain.',
				example: { source_creation_id: EXAMPLE_REMIX_SOURCE, instruction: 'make it matte black with gold trim' },
			},
			{
				free: {
					method: 'GET',
					path: '/api/remix-feed',
					operationId: 'remix_feed',
					params: {
						limit: {
							type: 'integer',
							example: 12,
							description: 'Number of remixable models to return.',
						},
					},
				},
				summary: 'Browse remixable 3D models and their royalty terms',
				description:
					'List published 3D models that accept remixes, with their GLB and preview URLs, royalty percentage, and remix count. Use a returned id as source_creation_id for a paid remix.',
			},
			{
				slug: 'embody',
				summary: 'Create a rigged, talking 3D avatar body for an AI agent',
				description:
					'Create a rigged, animated, voiced 3D avatar from a prompt or a photo. Returns the agent id, GLB URL, viewer and profile URLs, and an HTML embed. Failed generations are not charged.',
				params: {
					name: { description: 'Display name for the avatar and its agent profile.' },
					prompt: { description: 'Appearance of the avatar in plain language. Give this or image_url.' },
					image_url: { description: 'Public photo of the subject to build the avatar from. Give this or prompt.' },
					personality: { description: 'Optional persona text the avatar speaks and behaves from.' },
					voice: { description: 'Optional voice id for the avatar\'s speech.' },
				},
			},
			{
				slug: 'mint-to-mesh',
				summary: 'Render a Solana token mint as a themed GLB 3D object',
				description:
					'Turn any Solana SPL token mint into a GLB object themed from its on-chain metadata, with the token image as a texture when one exists and the metadata attached to the model.',
			},
			{
				slug: 'mint-to-mesh-batch',
				summary: 'Render up to 10 Solana token mints as themed GLB objects',
				description:
					'Resolve one to ten Solana SPL mints to themed GLB objects in one call. Each mint succeeds or fails on its own; GLB bytes come back base64-encoded in JSON.',
				example: { mints: [THREE_MINT] },
				params: {
					mints: { description: 'One to ten base58 SPL mint addresses on Solana mainnet.' },
				},
			},
		],
	},
	{
		name: 'market-data',
		title: 'three.ws Market Data',
		category: 'finance',
		description:
			'Crypto and DeFi market data: coin tables, coin profiles, price history, sectors, exchanges, derivatives, TVL by protocol and chain, yield pools, stablecoin pegs, fees, DEX volume, exploit history, news pulse, and token signals.',
		useCase:
			'Use for crypto prices, market caps, price charts, trending coins, DeFi TVL, yield farming research, stablecoin depeg checks, protocol exploit due diligence, perp funding rates, token market signals, or a one-call market overview.',
		body: `Pay-per-call crypto and DeFi market data from three.ws. Each endpoint is a
single GET that returns agent-ready JSON, priced in fractions of a cent. Data is
live from multiple upstream sources with failover; when an upstream is down the
call is refused before settlement, so you are never charged for an empty or
partial answer.

Start with \`/api/x402/market-pulse\` for broad context (global market, sentiment,
top coins, trending, TVL, stablecoin supply, DEX volume, and fees in one call),
then drill down with the narrow endpoints.

## Spend-aware usage

- Use \`market-pulse\` once instead of calling global, trending, defi, and
  stablecoin endpoints separately.
- Resolve a coin name to its id once with \`market-coins?q=<name>\` and reuse
  the id for \`market-coin\` and \`market-chart\`.
- Prefer the smallest \`limit\` that answers the question; most endpoints
  default to the full board.
- \`token-intel\` takes a contract address directly, so you can skip the id
  lookup for Solana tokens.
- Responses refresh every 1 to 10 minutes. Cache them instead of re-buying the
  same snapshot inside that window.`,
		operations: [
			{
				slug: 'market-pulse',
				summary: 'Fetch a one-call crypto market overview of eight feeds',
				description:
					'Return global market cap and dominance, the fear and greed index, top 10 coins, trending searches, gas, DeFi TVL with top protocols, stablecoin supply, DEX volume, and protocol fees in one response.',
			},
			{
				slug: 'token-intel',
				summary: 'Analyze a token by contract address with a market signal',
				description:
					'Return price, 24h change, market cap, liquidity, 24h volume, and a bullish, bearish, or neutral signal with a two-sentence rationale for any token by contract address.',
				params: {
					mint: { description: 'Token contract address: a Solana base58 mint or an EVM 0x address.' },
				},
			},
			{
				slug: 'market-coins',
				summary: 'Fetch a ranked crypto market table with 7-day sparklines',
				description:
					'Return coins ranked by market cap with price, market cap, 24h volume, 24h and 7d change, logo, and a 7-day sparkline, up to 250 per page. Pass q to resolve a name or ticker to coin ids.',
				params: {
					category: {
						description: 'Optional sector id from the market-categories endpoint to scope the table to one sector.',
					},
					q: { description: 'Search mode: resolve a name or ticker to coin ids and return the top 10 matches.' },
				},
			},
			{
				slug: 'market-coin',
				summary: 'Fetch a full profile for one coin by id or Solana mint',
				description:
					'Return live market stats (price, market cap, FDV, volume, change windows, all-time high and low, supply), official links, per-chain contract addresses, and developer and community stats for one coin.',
				example: { contract: THREE_MINT },
				params: {
					id: { description: 'Coin id: the lowercase slug from market-coins. Required unless contract is set.' },
					contract: { description: 'Solana token mint (base58), an alternative lookup key to id.' },
				},
			},
			{
				slug: 'market-chart',
				summary: 'Fetch the historical price series for one coin',
				description:
					'Return [timestamp_ms, price_usd] pairs for one coin over 1, 7, 30, 90, or 365 days, 5-minutely for one day, hourly up to 90 days, and daily beyond.',
				example: { id: 'solana', days: '30' },
				params: {
					id: { description: 'Coin id: the lowercase slug from market-coins, for example solana.' },
				},
			},
			{
				slug: 'market-categories',
				summary: 'Fetch crypto market sectors ranked by market cap',
				description:
					'Return every crypto sector ranked by market cap with 24h market-cap change, 24h volume, and its top three coins. Pass a sector id to market-coins to drill in.',
			},
			{
				slug: 'market-exchanges',
				summary: 'Fetch spot crypto exchanges ranked by trust and volume',
				description:
					'Return the top 100 spot exchanges ranked by trust score, each with 24h volume, trust rank, country, year established, and homepage.',
			},
			{
				slug: 'market-derivatives',
				summary: 'Fetch perpetual futures tickers, funding, and open interest',
				description:
					'Return the top 100 perpetual futures contracts by 24h volume with price, 24h change, funding rate, and open interest, or pass view=exchanges for the derivatives venue leaderboard.',
			},
			{
				slug: 'market-global',
				summary: 'Fetch the global crypto market cap, volume, and sentiment',
				description:
					'Return total crypto market cap, 24h volume, dominance shares, active coin count, and the fear and greed index with its label. A one-call market-regime check.',
			},
			{
				slug: 'market-trending',
				summary: 'Fetch the most-searched coins and trending categories',
				description:
					'Return the most-searched coins over the last 24 hours with price, 24h change, market cap, and trending rank, plus trending categories and NFT collections.',
			},
			{
				slug: 'market-defi',
				summary: 'Fetch DeFi protocols ranked by total value locked',
				description:
					'Return the top 100 DeFi protocols by TVL with 1d and 7d change, chains, category, token, and market cap, plus total DeFi TVL with exchange reserves excluded.',
			},
			{
				slug: 'market-chains',
				summary: 'Fetch blockchains ranked by DeFi total value locked',
				description:
					'Return the top 100 blockchains ranked by DeFi TVL, each with its native token symbol and share of total value locked, plus whole-market TVL.',
			},
			{
				slug: 'market-yields',
				summary: 'Search DeFi yield pools by chain, protocol, and TVL',
				description:
					'Query about 15,000 DeFi yield pools filtered by chain, protocol, stablecoin exposure, or text, sorted by TVL or APY, with pagination. Pass pool for one pool\'s APY and TVL history.',
				params: {
					project: { description: 'Filter to one protocol slug, as listed by market-defi.' },
					pool: {
						description: 'Chart mode: a pool id from a previous market-yields row. Returns that pool\'s APY and TVL history.',
					},
				},
			},
			{
				slug: 'market-stablecoins',
				summary: 'Fetch stablecoins ranked by supply with live peg prices',
				description:
					'Return the top 100 stablecoins by circulating supply with live price for a peg check, peg type and mechanism, and chains, plus total stablecoin market cap.',
			},
			{
				slug: 'market-fees',
				summary: 'Fetch DeFi protocols ranked by fees or revenue',
				description:
					'Return the top 100 protocols by 24h fees with 24h, 7d, and 30d totals and momentum. type=revenue ranks by what the protocol keeps instead of what users pay.',
			},
			{
				slug: 'market-dex-volumes',
				summary: 'Fetch decentralized exchanges ranked by 24h volume',
				description:
					'Return the top 100 DEXes by 24h volume with 7d volume, week-over-week change, chains, and share of total DEX volume, plus market totals and a daily chart.',
			},
			{
				slug: 'market-hacks',
				summary: 'Search the DeFi exploit history by name or technique',
				description:
					'Return historical DeFi exploits newest first with amount stolen, attack technique, classification, chains, bridge flag, post-mortem link, and funds returned. Search by name or technique.',
			},
			{
				slug: 'defi-radar',
				summary: 'Fetch DeFi TVL movers, top fee earners, and top DEXes',
				description:
					'Return total DeFi TVL, the largest 24h TVL gainers and losers, the top fee-earning protocols over 24h, 7d, and 30d, and the top DEXes by 24h volume in one snapshot.',
			},
			{
				slug: 'yield-scan',
				summary: 'Search DeFi yield pools with risk flags by APY or TVL',
				description:
					'Screen 15,000+ yield pools by chain, minimum TVL, and stablecoin-only exposure. Each pool carries base and reward APY, 30-day mean, TVL, and impermanent-loss, volatility, and spike flags.',
				params: {
					chain: { description: 'Filter to one chain by name, for example Solana (case-insensitive).' },
					stable: { description: 'true returns stablecoin-denominated pools only.' },
				},
			},
			{
				slug: 'stablecoin-health',
				summary: 'Monitor stablecoin peg deviation and supply flows',
				description:
					'Score every USD stablecoin on peg deviation in basis points (on-peg, drifting, or depegged), circulating supply, and 24h, 7d, and 30d supply change, with a depeg alert list.',
			},
			{
				slug: 'hack-check',
				summary: 'Check a DeFi protocol for past exploits before using it',
				description:
					'Return a clean or incident-history verdict for a protocol with every matching exploit (date, amount lost, technique, chains, recovered funds) and market-wide loss stats. Omit protocol for the latest incidents.',
			},
			{
				slug: 'market-heatmap',
				summary: 'Fetch top coins with momentum and market-breadth stats',
				description:
					'Return the top coins by market cap with rank, price, 1h, 24h, and 7d momentum, market cap, and volume, plus breadth stats (advancers versus decliners, average and median move).',
			},
			{
				slug: 'market-mood',
				summary: 'Calculate a 0-100 crypto market mood score',
				description:
					'Blend the fear and greed index with live headline sentiment from 192 crypto news feeds into one 0-100 mood score, returning both components, the driving headlines, and implied volatility.',
			},
			{
				slug: 'news-pulse',
				summary: 'Monitor news coverage and sentiment for one token ticker',
				description:
					'Count mentions of a ticker across 192 crypto news feeds in a 1-72 hour window and return unique outlets, sentiment split, coverage velocity versus the prior window, and top headlines.',
				params: {
					ticker: { description: 'Ticker symbol to scan for, for example THREE. A leading $ is optional.' },
				},
			},
		],
	},
	{
		name: 'agent-trust',
		title: 'three.ws Agent Trust',
		category: 'identity',
		description:
			'Counterparty checks for AI agents: 0-100 reputation scores for wallets, mints, and agents from on-chain evidence, admit or refuse verdicts against a trust policy, on-chain identity claim verification, and sourced fact checks.',
		useCase:
			'Use when an agent is about to pay, hire, trade with, or delegate to an unknown wallet, token, or agent: score its reputation, gate it with a trust policy, verify an address it claims, or fact-check a claim it made.',
		body: `Trust primitives for agent-to-agent commerce on three.ws. An agent about to
pay, hire, or delegate to a counterparty it has never met can buy evidence
first: a deterministic reputation score from on-chain history and settled
agent payments, a door verdict against its own trust policy, proof that an
identity really controls the address it claims, and a sourced verdict on a
factual claim.

Unknown subjects return a null score rather than an invented one, and every
verdict carries the evidence behind it.

## Spend-aware usage

- Check a counterparty once per session and cache the verdict; scores move
  slowly.
- Use \`agent-bouncer\` when you already hold a three.ws agent id and a policy;
  it is the cheapest yes-or-no gate.
- Use \`agent-reputation\` for wallets and mints outside three.ws.
- Keep fact-check claims to one checkable statement each. The first
  ${FACT_CHECK_FREE_DAILY} checks per day per IP are served free (marked \`lane: "free"\`);
  after that each check returns a 402.`,
		operations: [
			{
				slug: 'agent-reputation',
				summary: 'Score a wallet, token, or AI agent for trust from 0 to 100',
				description:
					'Return a deterministic 0-100 trust score for a wallet, token mint, ERC-8004 agent id, or three.ws agent id from transaction history, age, counterparties, holdings, and settled agent payments.',
				params: {
					subject: {
						description: 'Counterparty to score: a Solana or EVM wallet, a token mint, an ERC-8004 agent id, or a three.ws agent id.',
					},
					chain: { description: 'Optional EVM chain id or CAIP-2 chain to resolve an EVM subject on.' },
				},
			},
			{
				slug: 'agent-bouncer',
				summary: 'Check whether to admit an AI agent by its payment record',
				description:
					'Read a three.ws agent\'s Solana track record (payments, distinct payers, failure rate, attestations) and return an admit or refuse verdict with a tier: newcomer, regular, trusted, or vip.',
				example: { agent_id: EXAMPLE_AGENT_ID, min_payments: 10, min_distinct_payers: 3, max_failure_rate: 0.2 },
				params: {
					agent_id: { description: 'three.ws agent id (UUID) of the counterparty to check.' },
					min_payments: { description: 'Minimum confirmed on-chain payments the agent must have received.' },
					min_distinct_payers: { description: 'Minimum number of distinct wallets that have paid the agent.' },
					max_failure_rate: { description: 'Highest acceptable payment failure rate, from 0 to 1.' },
					min_attestations: { description: 'Minimum signed Solana attestations the agent must hold.' },
					allow_newcomers: { description: 'Admit agents with no history yet instead of refusing them.' },
				},
			},
			{
				slug: 'onchain-identity-verify',
				summary: 'Verify that an identity controls a wallet, mint, or contract',
				description:
					'Check a claim that an identity controls an address and return on-chain evidence (deployer, mint and update authority, name resolution, agent registration) with verified true, false, or unverifiable.',
				example: { identity: EXAMPLE_AGENT_ID, address: THREE_MINT },
				params: {
					identity: {
						description: 'Claimed identity: a wallet, a name-service name, an ERC-8004 agent id, or a three.ws agent id.',
					},
					address: { description: 'Contract, mint, or wallet the identity claims to control.' },
					chain: { description: 'Optional CAIP-2 chain hint for the address.' },
				},
			},
			{
				slug: 'fact-check',
				summary: 'Verify a factual claim and return a sourced verdict',
				description: `Check a claim against live web sources and return supported, contradicted, mixed, or insufficient with cited sources, a confidence score, and a SHA-256 attestation. The first ${FACT_CHECK_FREE_DAILY} checks per day per IP are free.`,
				params: {
					claim: { description: 'One factual statement to check, 5 to 1,000 characters.' },
					strictness: { description: 'How hard low-authority sources are downweighted: high, medium, or low.' },
					imageUrl: { description: 'Optional public image URL to check alongside the claim.' },
				},
			},
		],
	},
]);

// ── ASCII projection ─────────────────────────────────────────────────────────

// The registry rejects non-ASCII in listing text (it renders on OS biometric
// prompts). Descriptor schema text uses typographic characters, so map the
// ones it uses and let assertListing fail on anything else.
const ASCII_MAP = new Map([
	['\u2192', '->'], ['\u2190', '<-'], ['\u2014', ', '], ['\u2013', '-'], ['\u2026', '...'],
	['\u2265', '>='], ['\u2264', '<='], ['\u00d7', 'x'], ['\u2018', "'"], ['\u2019', "'"],
	['\u201c', '"'], ['\u201d', '"'], ['\u00b7', '-'], ['\u00a0', ' '],
]);

export function toAscii(text) {
	let out = '';
	for (const ch of String(text)) out += ASCII_MAP.get(ch) ?? ch;
	return out.replace(/ ,/g, ',').replace(/ {2,}/g, ' ');
}

function asciiDeep(value) {
	if (typeof value === 'string') return toAscii(value);
	if (Array.isArray(value)) return value.map(asciiDeep);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, asciiDeep(v)]));
	}
	return value;
}

// ── Listing rules (mirrors `pay catalog check`) ──────────────────────────────

const SUMMARY_MIN = 24;
const SUMMARY_MAX = 64;
const isAscii = (s) => /^[\x20-\x7e\n]*$/.test(s);

export function listingProblems(provider, openapi) {
	const problems = [];
	const where = `${OPERATOR}/${provider.name}`;
	const len = (s) => String(s || '').length;
	if (len(provider.description) < 64 || len(provider.description) > 255) {
		problems.push(`${where}: description must be 64-255 chars (got ${len(provider.description)})`);
	}
	if (len(provider.useCase) < 32 || len(provider.useCase) > 255) {
		problems.push(`${where}: use_case must be 32-255 chars (got ${len(provider.useCase)})`);
	}
	if (!/^Use (for|when) /.test(provider.useCase)) problems.push(`${where}: use_case must start with "Use for" or "Use when"`);
	if (!PAY_CATEGORIES.includes(provider.category)) problems.push(`${where}: unknown category ${provider.category}`);
	for (const field of ['title', 'description', 'useCase', 'body']) {
		if (!isAscii(provider[field])) problems.push(`${where}: ${field} has non-ASCII characters`);
	}
	for (const [path, item] of Object.entries(openapi.paths)) {
		for (const [method, op] of Object.entries(item)) {
			const at = `${where}: ${method.toUpperCase()} ${path}`;
			if (len(op.summary) < SUMMARY_MIN || len(op.summary) > SUMMARY_MAX) {
				problems.push(`${at}: summary must be ${SUMMARY_MIN}-${SUMMARY_MAX} chars (got ${len(op.summary)})`);
			}
			if (len(op.description) < 32 || len(op.description) > 255) {
				problems.push(`${at}: description must be 32-255 chars (got ${len(op.description)})`);
			}
			const text = JSON.stringify(op);
			if (!isAscii(text.replace(/\\n/g, ''))) problems.push(`${at}: operation has non-ASCII characters`);
			for (const p of op.parameters || []) {
				if (!p.description) problems.push(`${at}: parameter ${p.name} has no description`);
			}
			const schema = op.requestBody?.content?.['application/json']?.schema;
			for (const [name, prop] of Object.entries(schema?.properties || {})) {
				if (!prop.description) problems.push(`${at}: body field ${name} has no description`);
			}
		}
	}
	return problems;
}

// ── OpenAPI assembly ─────────────────────────────────────────────────────────

function serviceBySlug(slug) {
	const s = PAID_SERVICES.find((svc) => svc.slug === slug);
	if (!s) throw new Error(`pay-skills: no service-catalog descriptor for "${slug}"`);
	if (s.status !== 'live') throw new Error(`pay-skills: "${slug}" is ${s.status}, only live services are listed`);
	if (!SOLANA_BUILDERS.has(s.acceptsBuilder)) {
		throw new Error(`pay-skills: "${slug}" (${s.acceptsBuilder}) cannot be paid on Solana`);
	}
	return s;
}

function mergeProp(prop, override) {
	if (!override) return { ...prop };
	const { required: _required, ...rest } = override;
	return { ...prop, ...rest };
}

function queryParameters(schema, example, overrides = {}) {
	const required = new Set(schema?.required || []);
	const props = { ...(schema?.properties || {}) };
	for (const [name, o] of Object.entries(overrides)) {
		if (!props[name]) props[name] = { type: o.type || 'string' };
		if (o.required) required.add(name);
	}
	return Object.entries(props).map(([name, prop]) => {
		const merged = mergeProp(prop, overrides[name]);
		const { description, example: propExample, ...rest } = merged;
		const value = example && example[name] !== undefined ? example[name] : propExample;
		return {
			name,
			in: 'query',
			required: required.has(name),
			description,
			schema: { type: rest.type || 'string', ...rest },
			...(value !== undefined && value !== '' ? { example: value } : {}),
		};
	});
}

function requestBody(schema, example, overrides = {}) {
	const { $schema: _s, ...rest } = schema || { type: 'object', properties: {} };
	const properties = {};
	for (const [name, prop] of Object.entries(rest.properties || {})) {
		properties[name] = mergeProp(prop, overrides[name]);
	}
	return {
		required: true,
		content: {
			'application/json': {
				schema: { ...rest, properties },
				...(example ? { example } : {}),
			},
		},
	};
}

function paidOperation(op) {
	const s = serviceBySlug(op.slug);
	const example = op.example ?? s.input;
	const price = op.price ? op.price() : fixedPrice(s.priceAtomics);
	const isGet = s.method === 'GET';
	return [
		s.path,
		s.method.toLowerCase(),
		{
			operationId: s.slug.replace(/-/g, '_'),
			summary: op.summary,
			description: op.description,
			security: [],
			...(isGet
				? { parameters: queryParameters(s.inputSchema, example, op.params) }
				: { requestBody: requestBody(s.inputSchema, example, op.params) }),
			'x-payment-info': { price, protocols: [{ x402: {} }] },
			responses: {
				200: { description: 'Paid result as JSON.' },
				400: { description: 'Missing or invalid input. Refused before any payment settles.' },
				402: { description: 'Payment Required: an x402 challenge payable in USDC on Solana mainnet.' },
			},
		},
	];
}

function freeOperation(op) {
	const f = op.free;
	return [
		f.path,
		f.method.toLowerCase(),
		{
			operationId: f.operationId,
			summary: op.summary,
			description: op.description,
			security: [],
			parameters: queryParameters({ properties: {} }, null, f.params),
			responses: { 200: { description: 'Result as JSON. No payment required.' } },
		},
	];
}

export function buildOpenApi(provider) {
	const paths = {};
	for (const op of provider.operations) {
		const [path, method, operation] = op.free ? freeOperation(op) : paidOperation(op);
		paths[path] = { ...(paths[path] || {}), [method]: operation };
	}
	return asciiDeep({
		openapi: '3.1.0',
		info: {
			title: provider.title,
			version: '1.0.0',
			description: provider.description,
			'x-logo': { url: `${ORIGIN}/favicon.svg`, altText: 'three.ws' },
			'x-guidance':
				'Call an endpoint without payment to receive an x402 challenge, pay it in USDC on Solana mainnet, and retry with the payment header. Asynchronous 3D jobs return a token to poll for free at GET /api/forge?job=<token>.',
		},
		servers: [{ url: ORIGIN }],
		paths,
	});
}

function yamlString(s) {
	return JSON.stringify(s);
}

export function buildPayMd(provider) {
	return [
		'---',
		`name: ${provider.name}`,
		`title: ${yamlString(provider.title)}`,
		`description: ${yamlString(provider.description)}`,
		`use_case: ${yamlString(provider.useCase)}`,
		`category: ${provider.category}`,
		`service_url: ${ORIGIN}`,
		'openapi:',
		'  path: openapi.json',
		'---',
		'',
		provider.body.trim(),
		'',
	].join('\n');
}

// Every provider as the files its registry directory holds, keyed by path
// relative to the registry root. Throws with every rule violation at once.
export function buildPaySkills() {
	const files = {};
	const problems = [];
	for (const provider of PAY_PROVIDERS) {
		const openapi = buildOpenApi(provider);
		problems.push(...listingProblems(provider, openapi));
		const dir = `providers/${OPERATOR}/${provider.name}`;
		files[`${dir}/PAY.md`] = buildPayMd(provider);
		files[`${dir}/openapi.json`] = `${JSON.stringify(openapi, null, 2)}\n`;
	}
	if (problems.length) {
		throw new Error(`pay-skills listing rules failed:\n  ${problems.join('\n  ')}`);
	}
	return files;
}
