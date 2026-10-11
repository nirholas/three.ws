// Adds discovery topics to public, non-fork repos of the authenticated GitHub
// account that have none. Topics derive from each repo's name, description and
// primary language. Dry run unless --apply. Token: GITHUB_TOKEN.
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('set GITHUB_TOKEN');
const apply = process.argv.includes('--apply');
const skip = new Set(['fresh-start']);
const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

const RULES = [
	[/\bmcp\b|model context/i, ['mcp', 'mcp-server', 'model-context-protocol', 'ai-agents']],
	[/x402/i, ['x402', 'agent-payments']],
	[/solana|\bsol\b|\bspl\b|token-2022|pump\.?fun/i, ['solana']],
	[/pump\.?fun/i, ['pump-fun']],
	[/robinhood/i, ['robinhood-chain']],
	[/\bevm\b|ethereum|uniswap|solidity|erc-?\d+|calldata|create2/i, ['ethereum', 'evm']],
	[/uniswap v4|hook/i, ['uniswap-v4']],
	[/\bamm\b|liquidity|pool|swap/i, ['defi', 'amm']],
	[/\bsvg\b/i, ['svg']],
	[/\bnft\b|mint|token|coin|launch/i, ['crypto']],
	[/index fund|flock .*index|rebalanc/i, ['index-fund']],
	[/erc-?8004/i, ['erc-8004']],
	[/agent/i, ['ai-agents']],
	[/market data|coingecko|defillama/i, ['market-data', 'crypto-api']],
	[/portfolio|p&l|pnl/i, ['portfolio']],
	[/oracle/i, ['oracle']],
	[/watsonx|granite|ibm/i, ['ibm-watsonx']],
];
const LANG = { JavaScript: 'javascript', TypeScript: 'typescript', Python: 'python', Solidity: 'solidity', Rust: 'rust', HTML: 'html', Go: 'go' };

function topicsFor(r) {
	const text = `${r.name} ${r.description || ''}`;
	const set = new Set();
	for (const [re, ts] of RULES) if (re.test(text)) ts.forEach((t) => set.add(t));
	if (LANG[r.language]) set.add(LANG[r.language]);
	set.add('open-source');
	return [...set].filter((t) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(t)).slice(0, 12);
}

const repos = [];
for (let page = 1; ; page++) {
	const res = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner`, { headers: H });
	if (!res.ok) throw new Error(`list repos ${res.status}`);
	const batch = await res.json();
	repos.push(...batch);
	if (batch.length < 100) break;
}
const targets = repos.filter((r) => !r.private && !r.archived && !r.fork && !skip.has(r.name) && !(r.topics || []).length);
for (const r of targets) {
	const names = topicsFor(r);
	console.log(`${apply ? 'tag' : 'plan'} ${r.name}: ${names.join(', ')}`);
	if (!apply) continue;
	const res = await fetch(`https://api.github.com/repos/${r.full_name}/topics`, { method: 'PUT', headers: H, body: JSON.stringify({ names }) });
	if (!res.ok) console.error(`  failed ${res.status} ${await res.text()}`);
}
console.log(`${targets.length} repos ${apply ? 'tagged' : 'planned'}`);
