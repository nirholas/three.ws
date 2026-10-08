#!/usr/bin/env node
// check-earnings-board.mjs - cross-checks the earnings leaderboard against each
// agent's own earnings, on real data.
//
// GET /api/leaderboard/earnings and GET /api/agents/:id/earnings share one read
// model (api/_lib/agent-earnings.js), and the promise to users is that a row on
// /leaderboard?tab=earned and the Earned card on that agent's page never
// disagree. This script holds the live system to it: for every window it pages
// through the whole board, asks each ranked agent for its own earnings over the
// same window, and compares creator fees (exact lamports), service income (USD)
// and the total. For the windows an agent page reports a rank for, the rank
// must match the row's position too. Every row's total must equal its creator
// fees plus service income, and the board must be sorted by total.
//
// Read-only: it only issues public GET requests.
//
//   node scripts/check-earnings-board.mjs                       # https://three.ws
//   node scripts/check-earnings-board.mjs --base http://localhost:8080
//   node scripts/check-earnings-board.mjs --window 7d --window all
//
// Exit 0 when every row agrees, 1 on any mismatch, 2 when the API is unreachable.

const args = process.argv.slice(2);
const flag = (name) => {
	const out = [];
	args.forEach((a, i) => { if (a === `--${name}` && args[i + 1]) out.push(args[i + 1]); });
	return out;
};
const BASE = (flag('base')[0] || 'https://three.ws').replace(/\/$/, '');
const WINDOWS = flag('window').length ? flag('window') : ['24h', '7d', '30d', 'all'];
const PAGE = 100;
// SOL figures carry nine decimals; two independent roundings may differ in the last.
const SOL_EPS = 2e-9;

async function getJson(path) {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
		if (res.status === 429 && attempt < 5) {
			const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
			await new Promise((r) => setTimeout(r, wait * 1000));
			continue;
		}
		if (!res.ok) throw new Error(`${path} answered ${res.status}`);
		return res.json();
	}
}

async function wholeBoard(window) {
	const rows = [];
	let total = Infinity;
	let price = null;
	while (rows.length < total) {
		const page = await getJson(`/api/leaderboard/earnings?window=${window}&limit=${PAGE}&offset=${rows.length}`);
		total = page.total;
		price = page.sol_price_usd;
		rows.push(...page.rows);
		if (!page.rows.length) break;
	}
	return { rows, total, price };
}

function compareRow(window, row, mine, boardPrice) {
	const problems = [];
	if (row.creator_fees.lamports !== mine.creator_fees.lamports) {
		problems.push(`creator fees ${row.creator_fees.lamports} vs ${mine.creator_fees.lamports} lamports`);
	}
	if (row.service_income.usd !== mine.service_income.usd) {
		problems.push(`service income $${row.service_income.usd} vs $${mine.service_income.usd}`);
	}
	// The total converts service income at the response's SOL price; the two
	// calls can straddle a price refresh, so compare totals only at one price.
	if (boardPrice === mine.sol_price_usd && Math.abs(row.total.sol - mine.total.sol) > SOL_EPS) {
		problems.push(`total ${row.total.sol} vs ${mine.total.sol} SOL`);
	}
	const parts = (row.creator_fees.sol || 0) + (row.service_income.sol || 0);
	if (Math.abs(parts - row.total.sol) > SOL_EPS) problems.push(`row total ${row.total.sol} is not fees + service (${parts})`);
	// An agent page ranks itself on its own window, or on 7d when asked for all-time.
	const rankWindow = window === 'all' ? null : window;
	if (rankWindow && mine.rank && mine.rank.window === rankWindow && mine.rank.position !== row.rank) {
		problems.push(`rank #${row.rank} on the board vs #${mine.rank.position} on the agent page`);
	}
	return problems;
}

let failures = 0;
for (const window of WINDOWS) {
	let board;
	try {
		board = await wholeBoard(window);
	} catch (err) {
		console.error(`[earnings-board] ${window}: ${err.message}`);
		process.exit(2);
	}
	let boardSol = 0;
	let agentSol = 0;
	let lastTotal = Infinity;
	for (const row of board.rows) {
		if (row.total.sol > lastTotal + SOL_EPS) {
			failures++;
			console.log(`  ${window} #${row.rank} ${row.agent.name}: ranked above a smaller total`);
		}
		lastTotal = row.total.sol;
		const mine = await getJson(`/api/agents/${row.agent.id}/earnings?window=${window}`);
		boardSol += row.total.sol;
		agentSol += mine.total.sol;
		const problems = compareRow(window, row, mine, board.price);
		if (problems.length) {
			failures++;
			console.log(`  ${window} #${row.rank} ${row.agent.name} (${row.agent.id}): ${problems.join('; ')}`);
		}
	}
	console.log(
		`[earnings-board] ${window}: ${board.rows.length}/${board.total} ranked agents checked, ` +
			`board total ${boardSol.toFixed(9)} SOL, sum of agent pages ${agentSol.toFixed(9)} SOL at $${board.price ?? '?'} per SOL`,
	);
}

if (failures) {
	console.log(`[earnings-board] ${failures} row(s) disagree`);
	process.exit(1);
}
console.log('[earnings-board] every row matches its agent page');
