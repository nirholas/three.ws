// api/_lib/x402/fresh-workers/jobs.js
//
// What a fresh wallet buys, and where the purchase lands so the site can show
// it. Two kinds of job:
//
//   forge : one paid text-to-3D generation on /api/x402/forge (standard tier).
//           The prop is persisted through the same path the hourly forge
//           pipeline uses, so it appears in the /forged library with the fresh
//           wallet as its payer.
//   data  : one paid dataset from the market-data / intel storefront. The
//           response is stored in x402_data_desk with its receipt and served
//           by /api/data-desk for the /data-desk page.
//
// Every data job resolves its request contract (path, method, query, body,
// default price) from the ring catalog (../ring-catalog.js), which is derived
// from the handlers themselves, so a purchase never spends money on a request
// the endpoint would reject.

import { bySlug } from '../ring-catalog.js';
import { priceFor } from '../../x402-prices.js';
import { priceAtomicsForTier } from '../../forge-tiers.js';
import {
	forgePropForSeed,
	persistProp,
	ensureSchema as ensureForgePropsSchema,
} from '../pipelines/forge-content.js';
import { trimPayload } from './plan.js';

// The datasets worth buying every few minutes: each one is something a visitor
// can read at a glance and the site did not otherwise refresh on a schedule.
// Order is the rotation order; a tick takes the next few in turn.
export const DATA_JOBS = Object.freeze([
	{ slug: 'market-global', title: 'Global market snapshot', blurb: 'Total market cap, 24h volume, largest-coin dominance and the Fear & Greed index.' },
	{ slug: 'market-trending', title: 'Trending assets', blurb: 'The most-searched coins and categories of the last 24 hours.' },
	{ slug: 'market-gas', title: 'Gas oracle', blurb: 'Slow, standard and fast gas tiers with USD cost estimates.' },
	{ slug: 'market-defi', title: 'DeFi protocol TVL', blurb: 'Top protocols by total value locked with 1d and 7d change.' },
	{ slug: 'market-stablecoins', title: 'Stablecoin monitor', blurb: 'Top pegged assets by supply with live peg health.' },
	{ slug: 'news-pulse', title: 'News pulse', blurb: 'Headline flow and sentiment for $THREE over the last day.' },
	{ slug: 'market-fees', title: 'Protocol fees', blurb: 'Which protocols actually earn, ranked by 24h fees.' },
	{ slug: 'market-dex-volumes', title: 'DEX volume rankings', blurb: 'Decentralized exchanges ranked by 24h trading volume.' },
	{ slug: 'market-mood', title: 'Market mood', blurb: 'A one-number read of where the market is leaning right now.' },
	{ slug: 'market-hacks', title: 'Exploit database', blurb: 'Recorded DeFi hacks with amounts, techniques and 12-month totals.' },
	{ slug: 'market-yields', title: 'Yield opportunities', blurb: 'Pools ranked by APY with the median yield across the market.' },
	{ slug: 'defi-radar', title: 'DeFi radar', blurb: 'The protocols moving most right now.' },
	{ slug: 'market-chains', title: 'Chain TVL', blurb: 'Blockchains ranked by total value locked.' },
	{ slug: 'crypto-intel', title: 'Crypto intel: SOL', blurb: 'Live market intel for Solana.' },
	{ slug: 'market-pulse', title: 'Market pulse bundle', blurb: 'Global stats, Fear & Greed, top coins, gas, DeFi and stablecoins in one call.' },
	{ slug: 'market-heatmap', title: 'Market heatmap', blurb: 'Sector-by-sector performance at a glance.' },
	{ slug: 'three-intel', title: '$THREE intel', blurb: 'A live market signal for the platform coin.' },
	{ slug: 'market-coins', title: 'Coin markets', blurb: 'The ranked coin table: price, market cap, volume and 7-day change.' },
]);

export const DATA_JOB_SLUGS = Object.freeze(DATA_JOBS.map((j) => j.slug));

const FORGE_TIER = 'standard';

/** Resolve a data job's request contract and live price from the ring catalog. */
export function resolveDataJob(slug) {
	const meta = DATA_JOBS.find((j) => j.slug === slug);
	const entry = bySlug(slug);
	if (!meta || !entry) throw new Error(`fresh-workers: unknown data job "${slug}"`);
	const qs = entry.query ? `?${new URLSearchParams(entry.query).toString()}` : '';
	return {
		kind: 'data',
		slug,
		title: meta.title,
		blurb: meta.blurb,
		path: `${entry.path}${qs}`,
		endpointPath: entry.path,
		method: entry.method,
		body: entry.method === 'POST' ? entry.body() : null,
		priceAtomic: Number(priceFor(entry.priceSlug, entry.priceAtomicDefault)),
	};
}

/** Resolve the forge job for a tick: a prompt from the prop catalog keyed by the seed. */
export function resolveForgeJob(seed) {
	const { category, prompt } = forgePropForSeed(seed);
	return {
		kind: 'forge',
		slug: 'forge',
		title: `3D prop: ${category}`,
		blurb: prompt,
		category,
		path: '/api/x402/forge',
		endpointPath: '/api/x402/forge',
		method: 'POST',
		body: { prompt, tier: FORGE_TIER, aspect_ratio: '1:1' },
		priceAtomic: Number(priceAtomicsForTier(FORGE_TIER)),
	};
}

/** Resolve a planned { kind, slug } into a full job. */
export function resolveJob(planned, seed) {
	return planned.kind === 'forge' ? resolveForgeJob(seed) : resolveDataJob(planned.slug);
}

export async function ensureDataDeskSchema(sql) {
	await sql`
		CREATE TABLE IF NOT EXISTS x402_data_desk (
			id             bigserial PRIMARY KEY,
			ts             timestamptz NOT NULL DEFAULT now(),
			slug           text NOT NULL,
			title          text NOT NULL,
			endpoint_path  text NOT NULL,
			payload        jsonb NOT NULL,
			payer          text,
			tx_sig         text,
			amount_atomic  bigint NOT NULL DEFAULT 0,
			run_id         uuid,
			wallet_id      bigint
		)`;
	await sql`CREATE INDEX IF NOT EXISTS x402_data_desk_slug_ts ON x402_data_desk (slug, ts DESC)`;
	await sql`CREATE INDEX IF NOT EXISTS x402_data_desk_ts ON x402_data_desk (ts DESC)`;
}

/**
 * Land a successful purchase where the site reads it. Returns a compact
 * summary for the call log. Never throws: a sink fault is reported in the
 * summary so the payment is still recorded.
 */
export async function storeJobResult({ sql, job, wallet, result, runId }) {
	const payer = wallet.pubkey;
	const txSig = result.txSig || null;
	const amountAtomic = result.paid ? result.amountAtomic : 0;
	if (job.kind === 'forge') {
		try {
			await ensureForgePropsSchema();
		} catch (err) {
			return { sink: 'forge_autonomous_props', stored: false, error: `schema_failed:${err?.message}` };
		}
		const value = await persistProp({
			runId, prompt: job.body.prompt, category: job.category,
			response: result.responseBody, txSig, payer, amountAtomic,
		});
		return { sink: 'forge_autonomous_props', ...value };
	}
	try {
		await ensureDataDeskSchema(sql);
		const payload = trimPayload(result.responseBody);
		const rows = await sql`
			INSERT INTO x402_data_desk (slug, title, endpoint_path, payload, payer, tx_sig, amount_atomic, run_id, wallet_id)
			VALUES (${job.slug}, ${job.title}, ${job.endpointPath}, ${JSON.stringify(payload)}::jsonb,
			        ${payer}, ${txSig}, ${amountAtomic}, ${runId}, ${wallet.id})
			RETURNING id`;
		return { sink: 'x402_data_desk', stored: true, id: rows[0]?.id ?? null, slug: job.slug };
	} catch (err) {
		return { sink: 'x402_data_desk', stored: false, error: err?.message || 'persist_failed' };
	}
}
