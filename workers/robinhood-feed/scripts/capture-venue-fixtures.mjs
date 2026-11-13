// Capture one real launch per venue from Robinhood Chain mainnet into
// tests/fixtures/venue-launches.json. Each entry keeps the raw mint log, the
// transaction that produced it and the Transfer logs of its receipt, which is
// everything mints.js, venues.js and reputation.js read.
//
//   node scripts/capture-venue-fixtures.mjs [blocks=120000] [--fresh]
//
// By default venues already in the fixture file are kept and only venues not
// yet captured are added, so widening the window for a quiet venue never drops
// an existing capture. --fresh recaptures every venue from the window.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getFirstMints, launchFromMint, isPoolToken, TRANSFER_TOPIC } from '../src/mints.js';

const ZERO_TOPIC = `0x${'0'.repeat(64)}`;

/**
 * One fixture per venue launched in [from, to], newest launch per venue first.
 * The raw mint log is read back from the receipt, since the chunked scan only
 * keeps compact first-mint records.
 *
 * @param {{ request: Function, getTransaction: Function, readContract: Function }} rpc viem client methods
 * @param {bigint} from
 * @param {bigint} to
 * @param {{ skipVenues?: Set<string>, sleep?: (ms: number) => Promise<void>, log?: (msg: string) => void }} [opts]
 */
export async function captureVenueLaunches(rpc, from, to, { skipVenues = new Set(), sleep, log = () => {} } = {}) {
	const mints = await getFirstMints((a) => rpc.request(a), from, to, sleep ? { sleep } : {});
	const byVenue = new Map();
	for (const mint of [...mints].reverse()) {
		const tx = await rpc.getTransaction({ hash: mint.transactionHash }).catch(() => null);
		const launch = launchFromMint(mint, tx);
		if (!launch || skipVenues.has(launch.venue.id) || byVenue.has(launch.venue.id)) continue;
		if (await isPoolToken((a) => rpc.readContract(a), mint.token)) continue;
		const receipt = await rpc.request({ method: 'eth_getTransactionReceipt', params: [mint.transactionHash] });
		const transfers = (receipt?.logs || []).filter((l) => l.topics?.[0] === TRANSFER_TOPIC);
		const mintLog = transfers.find((l) => l.address.toLowerCase() === mint.token.toLowerCase() && l.topics.length === 3 && l.topics[1] === ZERO_TOPIC);
		if (!mintLog) continue;
		byVenue.set(launch.venue.id, {
			venue: launch.venue.id,
			mintLog,
			tx: { hash: tx.hash, from: tx.from, to: tx.to, input: tx.input, blockNumber: String(tx.blockNumber) },
			transferLogs: transfers.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: Number(BigInt(l.logIndex)) })),
		});
		log(`captured ${launch.venue.id} (${launch.venue.label}) ${mint.token}`);
	}
	return [...byVenue.values()];
}

async function main() {
	const { hood } = await import('../src/chain.js');
	const args = process.argv.slice(2);
	const fresh = args.includes('--fresh');
	const span = BigInt(args.find((a) => /^\d+$/.test(a)) || 120_000);
	const out = fileURLToPath(new URL('../tests/fixtures/venue-launches.json', import.meta.url));
	const existing = !fresh && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
	const kept = existing?.launches || [];

	const head = await hood.public.getBlockNumber();
	const rpc = {
		request: (a) => hood.public.request(a),
		getTransaction: (a) => hood.public.getTransaction(a),
		readContract: (a) => hood.public.readContract(a),
	};
	const added = await captureVenueLaunches(rpc, head - span, head, {
		skipVenues: new Set(kept.map((c) => c.venue)),
		log: (m) => console.error(m),
	});
	const launches = [...kept, ...added];
	writeFileSync(out, `${JSON.stringify({
		captured_at_block: String(head),
		window_blocks: String(existing && BigInt(existing.window_blocks) > span ? existing.window_blocks : span),
		launches,
	}, null, '\t')}\n`);
	console.error(`kept ${kept.length}, added ${added.length}, wrote ${launches.length} venues to ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
}
