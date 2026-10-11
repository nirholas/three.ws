// Goal taxonomy for the /everything directory and the ⌘K "Browse by goal" group.
//
// pages.json groups pages by where they live in the site (Main, Build, Labs,
// Crypto). A visitor does not think that way: they think "I want to animate my
// avatar" or "I want to launch a coin". This module assigns every product page
// in pages.json exactly one JOB (an outcome), so the directory, the palette and
// the "next step" strip all read one classification instead of drifting apart.
//
// How a page gets its job, first match wins:
//   1. OVERRIDES: an exact path pinned to a job (fixes anything the rules miss).
//   2. RULES: ordered regexes on the path. Order matters: specific before broad.
//   3. The section default (a page in Account is always an account page).
//
// `tests/feature-jobs.test.js` pins the invariants: every product page resolves
// to a real job, no job is empty, and the pinned journeys stay where they are.

export const JOBS = [
	{
		id: 'make',
		title: 'Make a 3D model or avatar',
		promise: 'Describe it, photograph it or scan yourself. Get a textured, rigged GLB.',
		start: '/create',
		featured: ['/create', '/forge', '/image-to-3d', '/create/selfie', '/create/prompt', '/restyle', '/workbench'],
	},
	{
		id: 'animate',
		title: 'Animate and perform',
		promise: 'Poses, gestures, mocap, lip-sync and wardrobe for any humanoid avatar.',
		start: '/animations',
		featured: ['/animations', '/choreograph', '/mocap-studio', '/wardrobe', '/lipsync', '/gestures'],
	},
	{
		id: 'agent',
		title: 'Build an AI agent',
		promise: 'Give your avatar a brain, memory, skills and a voice, then put it to work.',
		start: '/create-agent',
		featured: ['/create-agent', '/chat', '/skills/community', '/companion', '/concierge'],
	},
	{
		id: 'embed',
		title: 'Put it on your site',
		promise: 'One web component, SDKs and widgets to ship your avatar anywhere.',
		start: '/widgets',
		featured: ['/widgets', '/avatar-sdk', '/glance', '/artifact', '/materialize'],
	},
	{
		id: 'earn',
		title: 'Sell and earn',
		promise: 'Price skills per call, hire agents, collect payouts. USDC and $THREE.',
		start: '/marketplace',
		featured: ['/marketplace', '/pay', '/credits', '/x402/studio', '/agent-exchange'],
	},
	{
		id: 'launch',
		title: 'Launch a token',
		promise: 'Launch on Solana, track your launches and run the $THREE launchpad.',
		start: '/launch',
		featured: ['/launch', '/three-launchpad', '/launches', '/three-token', '/launch-studio'],
	},
	{
		id: 'trade',
		title: 'Trade and track markets',
		promise: 'Live Solana and Robinhood Chain data, smart money, signals and terminals.',
		start: '/markets',
		featured: ['/markets', '/trenches', '/terminal', '/smart-money', '/signals', '/oracle'],
	},
	{
		id: 'onchain',
		title: 'Wallets and on-chain identity',
		promise: 'Agent wallets, ERC-8004 identity, reputation, domains and certificates.',
		start: '/agent-identities',
		featured: ['/agent-identities', '/deploy-onchain', '/reputation', '/domains', '/cert'],
	},
	{
		id: 'worlds',
		title: 'Worlds, AR and play',
		promise: 'Walk your avatar through worlds, place it in AR, compete and play.',
		start: '/walk',
		featured: ['/walk', '/ar', '/play', '/daily', '/leaderboard'],
	},
	{
		id: 'explore',
		title: 'Discover and get inspired',
		promise: 'Browse agents, galleries, showcases and what the community built.',
		start: '/discover',
		featured: ['/discover', '/gallery', '/showcase', '/what-is', '/tour'],
	},
	{
		id: 'dev',
		title: 'Developer tools',
		promise: 'MCP servers, CLIs, inspectors and diagnostics for builders.',
		start: '/connect',
		featured: ['/inspect', '/avatar-cli', '/prompts', '/integrations', '/rig-doctor'],
	},
	{
		id: 'account',
		title: 'Your account',
		promise: 'Credits, payments, domains and everything you own.',
		start: '/mine',
		featured: ['/pricing', '/creations', '/minted'],
	},
];

const JOB_IDS = new Set(JOBS.map((j) => j.id));

// Exact-path pins. Use sparingly: a rule that is wrong in one place is fixed
// here, a rule that is wrong in many places is fixed in RULES.
export const OVERRIDES = {
	'/features/ar': 'explore',
	'/features/forge': 'explore',
	'/features/scan': 'explore',
	'/features/play': 'explore',
	'/features/walk': 'explore',
	'/features/studio': 'explore',
	'/features/marketplace': 'explore',
	'/features/agent-exchange': 'explore',
	'/features/deploy': 'explore',
	'/agora': 'agent',
	'/threews/claim': 'account',
	'/x/claim': 'account',
	'/anatomy': 'worlds',
	'/holo': 'worlds',
	'/pocket': 'worlds',
	'/coin3d': 'trade',
	'/data-desk': 'trade',
	'/app': 'make',
	'/hero-demo': 'explore',
	'/constellation': 'explore',
	'/': 'explore',
	'/classic': 'explore',
	'/features': 'explore',
	'/sitemap': 'explore',
	'/search': 'explore',
	'/atlas': 'explore',
	'/marketplace': 'earn',
	'/marketplace/analytics': 'earn',
	'/three': 'launch',
	'/three-token': 'launch',
	'/three-live': 'launch',
	'/launchpad': 'launch',
	'/launches': 'launch',
	'/pill': 'launch',
	'/agent-exchange': 'earn',
	'/agent-economy': 'earn',
	'/agent-economy-volume': 'earn',
	'/economy': 'earn',
	'/economy-lab': 'earn',
	'/play/economy': 'earn',
	'/labor-market': 'earn',
	'/bazaar': 'earn',
	'/pay': 'earn',
	'/x402': 'earn',
	'/x402/studio': 'earn',
	'/ca2x402': 'earn',
	'/ibm/x402-demo': 'earn',
	'/agent-wallet': 'onchain',
	'/play/agent-wallet': 'onchain',
	'/evm-wallet': 'onchain',
	'/vanity-wallet': 'onchain',
	'/claim-wallet': 'onchain',
	'/vault': 'onchain',
	'/vaults': 'onchain',
	'/agents': 'explore',
	'/agents-live': 'explore',
	'/spotlight': 'explore',
	'/stories': 'explore',
	'/chat': 'agent',
	'/assistant': 'agent',
	'/prompts': 'dev',
	'/avatar-sdk': 'embed',
	'/avatar-cli': 'dev',
	'/avatar-studio': 'make',
	'/create': 'make',
	'/create-agent': 'agent',
	'/create/video': 'make',
	'/mine': 'account',
	'/creations': 'account',
	'/minted': 'account',
	'/portfolio': 'trade',
	'/club': 'explore',
	'/community': 'explore',
	'/crews': 'explore',
	'/contributors': 'explore',
	'/partners': 'explore',
	'/press': 'explore',
	'/pitch': 'explore',
	'/what-is': 'explore',
	'/timeline': 'explore',
	'/tour': 'explore',
	'/tour/atlas': 'explore',
	'/showcase': 'explore',
	'/gallery': 'explore',
	'/pricing': 'account',
	'/openai': 'dev',
	'/grok': 'dev',
	'/nvidia': 'dev',
	'/walk': 'worlds',
	'/walk-leaderboard': 'worlds',
	'/leaderboard': 'worlds',
	'/rankings': 'worlds',
	'/daily': 'worlds',
	'/daily-match': 'worlds',
	'/event': 'worlds',
	'/stage': 'worlds',
	'/concierge': 'agent',
	'/companion': 'agent',
	'/knock': 'agent',
	'/herald': 'agent',
	'/alpha-copilot': 'trade',
	'/copy-coach': 'trade',
	'/ghost-copy': 'trade',
	'/trade-rooms': 'trade',
	'/syndicates': 'trade',
	'/trading': 'trade',
	'/agent-trade': 'trade',
	'/autopilot': 'agent',
	'/autopilot-activity': 'agent',
};

// Ordered. First regex that matches the path wins.
export const RULES = [
	// Launch
	[/^\/launch/, 'launch'],
	[/^\/(drops|airdrops|three-launchpad|pumpfun|pump-live|pump-dashboard|pump-visualizer|sniper)/, 'launch'],
	// Developer surfaces
	[/^\/(connect|mcp|mcp-tools|docs|api|cli|inspect|embed-doctor|rig-doctor|validation|diff|render-lab|tty|bundles|integrations|spatial-mcp|crawl|monitor|preflight|providers|lookup|hydrate|stream|ibm)(\/|$)/, 'dev'],
	// Embedding
	[/^\/(widgets|glance|artifact|avatar-artifact|app|materialize|seeker|portal|smart-home|voice|hero-demo|constellation)(\/|$)/, 'embed'],
	// Animate
	[/^\/(animations|gestures|sonar|choreograph|sign-language|asl-alphabet|sign-mirror|wardrobe|diorama|mocap-studio|motion-swap|lipsync|pose|drive|clip-director|symphony|dad|fits|theater)(\/|$)/, 'animate'],
	// Make
	[/^\/(forge|forged|image-to-3d|create|restyle|splat|capture|modly|workbench|scene|compose|cosmos|genome|genesis|character-library|characters|objects|cad|anatomy|avatar-engines|avatar-edit|temporary|scan|coin3d|holo|pocket)(\/|$|-)/, 'make'],
	// Worlds / AR / play
	[/^\/(ar|globe|galaxy|assembly|irl|irl-privacy|world-lines|play|clash|duels|arena|quests|wrapped|playground|labs|experiments|mirror|swarms|ufo)(\/|$)/, 'worlds'],
	// Agents
	[/^\/(agenc|brain|tutor|shopper|forever|unstoppable|fact-check|fact-checker|skills|team-chat|teams|communities)(\/|$)/, 'agent'],
	// On-chain identity and wallets
	[/^\/(agent-identities|reputation|domains|cert|deploy-onchain|deployments|onchain|receipts|atomic|bnb|bnb-latency|guardian|proof|vanity|eth-vanity|meta-allocator)(\/|$)/, 'onchain'],
	// Earn
	[/^\/(marketplace|credits|payments|pay|billing|x402|bazaar|recurring|ledger)(\/|$)/, 'earn'],
	// Trade and markets
	[/^\/(markets|coins|trenches|pulse|flow|signals|tracker|terminal|radar|watchlist|strategy-lab|strategies|exit-lab|coin-intel|heatmap|fear-greed|gas|compare|screener|categories|exchanges|derivatives|converter|defi|chains|stablecoins|yields|fees|dex-volumes|hacks|trending|trades|smart-money|fade|arbitrage|gmgn|dextools|chart-companion|oracle|oracle-lab|activity|pipeline|analytics|viability|event-markets|live|demo|sperax|agi|go)(\/|$)/, 'trade'],
	// Account
	[/^\/(login|register|forgot-password|settings|profile|dashboard|my-agents|conversions)(\/|$)/, 'account'],
];

const SECTION_DEFAULT = {
	main: 'explore',
	build: 'make',
	labs: 'worlds',
	crypto: 'trade',
	'agent-tools': 'agent',
	account: 'account',
};

/** Sections whose pages are product surfaces and therefore get a job. */
export const PRODUCT_SECTIONS = new Set(Object.keys(SECTION_DEFAULT));

export function jobFor(path, sectionId) {
	const pinned = OVERRIDES[path];
	if (pinned) return pinned;
	for (const [re, job] of RULES) if (re.test(path)) return job;
	return SECTION_DEFAULT[sectionId] || null;
}

export function isJob(id) {
	return JOB_IDS.has(id);
}
