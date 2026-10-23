// Capture one real launch per venue from Robinhood Chain mainnet into
// tests/fixtures/venue-launches.json. Each entry keeps the raw mint log, the
// transaction that produced it and the Transfer logs of its receipt, which is
// everything mints.js, venues.js and reputation.js read.
//
//   node scripts/capture-venue-fixtures.mjs [blocks=120000]

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hood } from '../src/chain.js';
import { getMintLogs, parseMintLogs, launchFromMint, isPoolToken, TRANSFER_TOPIC } from '../src/mints.js';

const span = BigInt(process.argv[2] || 120_000);
const head = await hood.public.getBlockNumber();
const logs = await getMintLogs((a) => hood.public.request(a), head - span, head);
const mints = parseMintLogs(logs);
const byVenue = new Map();

for (const mint of mints.reverse()) {
	const tx = await hood.public.getTransaction({ hash: mint.transactionHash }).catch(() => null);
	const launch = launchFromMint(mint, tx);
	if (!launch || byVenue.has(launch.venue.id)) continue;
	if (await isPoolToken((a) => hood.public.readContract(a), mint.token)) continue;
	const receipt = await hood.public.getTransactionReceipt({ hash: mint.transactionHash });
	const mintLog = logs.find((l) => l.transactionHash === mint.transactionHash && l.address.toLowerCase() === mint.token.toLowerCase());
	byVenue.set(launch.venue.id, {
		venue: launch.venue.id,
		mintLog,
		tx: { hash: tx.hash, from: tx.from, to: tx.to, input: tx.input, blockNumber: String(tx.blockNumber) },
		transferLogs: receipt.logs
			.filter((l) => l.topics[0] === TRANSFER_TOPIC)
			.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex })),
	});
	console.error(`captured ${launch.venue.id} (${launch.venue.label}) ${mint.token}`);
}

const out = fileURLToPath(new URL('../tests/fixtures/venue-launches.json', import.meta.url));
writeFileSync(out, `${JSON.stringify({ captured_at_block: String(head), window_blocks: String(span), launches: [...byVenue.values()] }, null, '\t')}\n`);
console.error(`wrote ${byVenue.size} venues to ${out}`);
process.exit(0);
