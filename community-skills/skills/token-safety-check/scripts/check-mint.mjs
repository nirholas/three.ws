#!/usr/bin/env node
// Token safety facts for one Solana mint, straight from a public JSON-RPC node.
//
//   node scripts/check-mint.mjs <mint> [--rpc <url>] [--json]
//
// Reads, never signs. Reports mint authority, freeze authority, supply, the
// token program (Token-2022 extensions flagged), and holder concentration from
// the twenty largest token accounts. Node 18+ (global fetch), no dependencies.
//
// RPC failover, in order: --rpc or SOLANA_RPC_URL when given, then the three.ws
// public read proxy, then the public mainnet endpoint. Public nodes throttle
// getTokenLargestAccounts on busy mints, so one endpoint alone is not enough.

const args = process.argv.slice(2);
const mint = args.find((a) => !a.startsWith('--'));
const rpcFlag = args.indexOf('--rpc');
const RPCS = [
	(rpcFlag >= 0 && args[rpcFlag + 1]) || process.env.SOLANA_RPC_URL,
	'https://three.ws/api/solana-rpc',
	'https://api.mainnet-beta.solana.com',
].filter(Boolean);
const asJson = args.includes('--json');

if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
	console.error('usage: node scripts/check-mint.mjs <mint address> [--rpc <url>] [--json]');
	process.exit(2);
}

const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
// Token-2022 extensions that let the issuer keep power over holders' tokens.
const RISKY_EXTENSIONS = new Set(['permanentDelegate', 'transferHook', 'transferFeeConfig', 'defaultAccountState', 'pausableConfig', 'nonTransferable']);

const used = new Set();

// First endpoint that answers wins. A throttle, a server error, or a network
// failure moves on to the next one; a JSON-RPC error is the chain's answer and
// is reported as-is.
async function rpc(method, params) {
	const failures = [];
	for (const url of RPCS) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
				signal: AbortSignal.timeout(15000),
			});
			if (!res.ok) {
				failures.push(`${url}: HTTP ${res.status}`);
				continue;
			}
			const body = await res.json();
			if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { rpcAnswer: true });
			used.add(url);
			return body.result;
		} catch (err) {
			if (err.rpcAnswer) throw err;
			failures.push(`${url}: ${err.message}`);
		}
	}
	throw new Error(`${method} failed on every endpoint:\n  ${failures.join('\n  ')}\nPass --rpc with your own endpoint.`);
}

const account = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
const parsed = account?.value?.data?.parsed;
if (!parsed || parsed.type !== 'mint') {
	console.error(`${mint} is not an SPL token mint on this cluster`);
	process.exit(1);
}

const info = parsed.info;
const decimals = info.decimals;
const supply = Number(info.supply) / 10 ** decimals;
const program = account.value.owner;
const extensions = (info.extensions || []).map((e) => e.extension);
const risky = extensions.filter((e) => RISKY_EXTENSIONS.has(e));

const largest = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
const top = (largest?.value || []).map((a) => ({ account: a.address, amount: Number(a.uiAmount || 0) }));
const share = (n) => (supply > 0 ? (top.slice(0, n).reduce((s, a) => s + a.amount, 0) / supply) * 100 : 0);

const flags = [];
if (info.mintAuthority) flags.push('mint authority is live: the issuer can print more supply');
if (info.freezeAuthority) flags.push('freeze authority is live: the issuer can freeze any holder');
if (risky.length) flags.push(`Token-2022 extensions that keep issuer control: ${risky.join(', ')}`);
if (top[0] && share(1) > 20) flags.push(`largest account holds ${share(1).toFixed(1)}% of supply (may be a pool or curve; check before judging)`);
if (share(10) > 50) flags.push(`top 10 accounts hold ${share(10).toFixed(1)}% of supply`);

const report = {
	mint,
	rpc: [...used],
	program: program === TOKEN_2022 ? 'token-2022' : 'spl-token',
	decimals,
	supply,
	mint_authority: info.mintAuthority || null,
	freeze_authority: info.freezeAuthority || null,
	extensions,
	top1_pct: Number(share(1).toFixed(2)),
	top10_pct: Number(share(10).toFixed(2)),
	top20_pct: Number(share(20).toFixed(2)),
	largest_accounts: top.slice(0, 10),
	flags,
	verdict: flags.length === 0 ? 'no on-chain red flags' : `${flags.length} red flag${flags.length === 1 ? '' : 's'}`,
};

if (asJson) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(`mint            ${mint}`);
	console.log(`program         ${report.program}${extensions.length ? ` (extensions: ${extensions.join(', ')})` : ''}`);
	console.log(`supply          ${supply.toLocaleString('en-US')} (decimals ${decimals})`);
	console.log(`mint authority  ${report.mint_authority || 'revoked'}`);
	console.log(`freeze auth     ${report.freeze_authority || 'revoked'}`);
	console.log(`top 1 / 10 / 20 ${report.top1_pct}% / ${report.top10_pct}% / ${report.top20_pct}%`);
	console.log(`verdict         ${report.verdict}`);
	for (const f of flags) console.log(`  - ${f}`);
}
