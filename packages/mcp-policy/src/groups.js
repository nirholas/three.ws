// The vocabulary every three.ws MCP tool is classified under.
//
// A tool belongs to exactly one GROUP (what it is about) and one TIER (what it
// can do to the caller). Groups are what a user toggles; tiers decide what is
// on before the user has toggled anything.

/** How long a preview or quote stays usable by the financial tool that needs it. */
export const PREVIEW_TTL_MS = 10 * 60 * 1000;

/**
 * Tiers, in increasing order of consequence.
 *   read       changes nothing. On by default.
 *   write      changes account state, but a follow-up call can undo it. On by default.
 *   financial  moves funds or cannot be undone. Off until the user opts in, and
 *              every call needs a named confirm flag plus a fresh preview.
 */
export const TIERS = Object.freeze(['read', 'write', 'financial']);

/** Tiers a fresh key sees with no settings at all. */
export const DEFAULT_TIERS = Object.freeze(['read', 'write']);

/**
 * The confirm flags a financial tool may require. Each names the kind of
 * consequence, so a model reading `confirm_transfer: true` in its own call knows
 * what it is attesting to. `confirm_run` covers the tools that act on the
 * physical world or execute arbitrary code, which move no money but cannot be
 * taken back.
 */
export const CONFIRM_FLAGS = Object.freeze([
	'confirm_swap',
	'confirm_transfer',
	'confirm_launch',
	'confirm_spend',
	'confirm_payment',
	'confirm_deposit',
	'confirm_withdraw',
	'confirm_delete',
	'confirm_bid',
	'confirm_send',
	'confirm_run',
]);

/** The argument a financial tool takes to prove its preview ran. */
export const PREVIEW_ARGS = Object.freeze(['quote_id', 'preview_id']);

/**
 * Every group, in the order the settings page and the skill document list them.
 * `summary` is written for the person deciding whether to turn the group on.
 */
export const GROUPS = Object.freeze([
	{ id: 'agents', label: 'Agents', summary: 'Create, inspect, and remember things for your agents: identities, memory, provenance, on-chain registration.' },
	{ id: 'chat', label: 'Chat', summary: 'Run a model: chat completions, embeddings, tutoring sessions, and the model catalog.' },
	{ id: 'runs', label: 'Runs', summary: 'Autonomous work: autopilot proposals, their dry runs, and the log of what an agent did on its own.' },
	{ id: 'skills', label: 'Skills', summary: 'Author, list, and install the skills an agent can use.' },
	{ id: 'trading', label: 'Trading', summary: 'Quote and execute swaps from an agent wallet, copy trading, and signal subscriptions.' },
	{ id: 'orders', label: 'Orders', summary: 'Open orders, DCA strategies, and wallet intents that execute later.' },
	{ id: 'perps', label: 'Perps', summary: 'Perpetual futures positions.' },
	{ id: 'lending', label: 'Lending', summary: 'Supply, borrow, and repay on lending markets.' },
	{ id: 'predictions', label: 'Predictions', summary: 'Prediction market positions.' },
	{ id: 'launch', label: 'Launch', summary: 'Launch a coin: metadata upload, vanity mints, launch, and creator-fee collection.' },
	{ id: 'marketplace', label: 'Marketplace', summary: 'Browse and hire agents and skills, the job board, and bounty markets.' },
	{ id: 'cards', label: 'Cards', summary: 'Agent payment cards.' },
	{ id: 'mail', label: 'Mail', summary: 'Outward messages: paid knocks, announcements to a person, and agent mail.' },
	{ id: 'x402', label: 'x402', summary: 'Discover, price, and pay x402 services; payment sessions; publish your own paid endpoint.' },
	{ id: 'wallet', label: 'Wallet', summary: 'Agent wallets: balances, portfolio, provisioning, and transfers out.' },
	{ id: 'billing', label: 'Billing', summary: 'Plan, usage, receipts, and platform fees.' },
	{ id: 'intelligence', label: 'Intelligence', summary: 'Market data and research: token intel, holders, trades, smart money, KOLs, Oracle conviction, alerts.' },
	{ id: 'integrations', label: 'Integrations', summary: 'Embeds, widgets, and connected systems such as a Home Assistant house.' },
	{ id: 'account', label: 'Account', summary: 'Notifications, delivery preferences, and push devices.' },
	{ id: 'allowlist', label: 'Allowlist', summary: 'The destinations an agent wallet may send funds to.' },
	{ id: 'assets', label: 'Assets', summary: '3D generation, avatars, animation, rigging, rendering, and the asset catalog.' },
	{ id: 'utility', label: 'Utility', summary: 'Getting-started guides, name resolution, vision, speech, and other stateless helpers.' },
]);

export const GROUP_IDS = Object.freeze(GROUPS.map((g) => g.id));
