-- Migration: crypto-category skills + remap web3 → crypto
-- Idempotent via ON CONFLICT (slug) DO NOTHING / UPDATE.

begin;

-- Re-categorize existing web3 skills to 'crypto' so the Crypto tab is populated.
update marketplace_skills
set category = 'crypto', tags = tags || '{crypto}'::text[]
where category = 'web3'
  and author_id is null;

-- New crypto skills
insert into marketplace_skills (name, slug, description, category, tags, schema_json, is_public, author_id) values

(
  'Gas Tracker',
  'gas-tracker',
  'Show current Ethereum gas prices (slow / standard / fast) via the Etherscan API.',
  'crypto',
  '{"ethereum","gas","defi","crypto"}',
  '[{"clientDefinition":{"id":"gas-tracker-001","name":"GasTracker","description":"Returns current Ethereum gas price estimates.","arguments":[],"body":"const r = await fetch(''https://api.etherscan.io/api?module=gastracker&action=gasoracle'');\nif (!r.ok) throw new Error(''Etherscan failed: '' + r.status);\nconst d = await r.json();\nif (d.status !== ''1'') throw new Error(d.message || ''API error'');\nconst { SafeGasPrice: slow, ProposeGasPrice: standard, FastGasPrice: fast } = d.result;\nreturn { slow_gwei: slow, standard_gwei: standard, fast_gwei: fast };"},"type":"function","function":{"name":"GasTracker","description":"Get current Ethereum gas prices (slow, standard, fast) in Gwei. Use when the user asks about gas fees or network congestion.","parameters":{"type":"object","properties":{}}}}]',
  true,
  null
),

(
  'NFT Floor Price',
  'nft-floor',
  'Fetch the floor price and stats for any NFT collection on Ethereum or Solana.',
  'crypto',
  '{"nft","floor","opensea","solana","crypto"}',
  '[{"clientDefinition":{"id":"nft-floor-001","name":"NFTFloorPrice","description":"Fetches floor price and collection stats via OpenSea API.","arguments":[{"name":"slug","type":"string","description":"OpenSea collection slug, e.g. boredapeyachtclub"}],"body":"const slug = encodeURIComponent(String(args.slug || '''').trim());\nif (!slug) throw new Error(''slug required'');\nconst r = await fetch(''https://api.opensea.io/api/v2/collections/'' + slug + ''/stats'', { headers: { accept: ''application/json'' } });\nif (!r.ok) throw new Error(''OpenSea failed: '' + r.status);\nconst d = await r.json();\nconst t = d.total || {};\nreturn {\n  floor_price: t.floor_price,\n  volume_24h: t.volume_24h,\n  num_owners: t.num_owners,\n  total_supply: t.total_supply,\n  sales_24h: t.sales_24h\n};"},"type":"function","function":{"name":"NFTFloorPrice","description":"Get the floor price and collection stats for an NFT collection. Use when asked about NFT prices, floor prices, or collection volume.","parameters":{"type":"object","properties":{"slug":{"type":"string","description":"OpenSea collection slug (e.g. boredapeyachtclub)"}},"required":["slug"]}}}]',
  true,
  null
),

(
  'Crypto Fear & Greed',
  'crypto-fear-greed',
  'Fetch the current Crypto Fear & Greed Index and display a styled gauge.',
  'crypto',
  '{"sentiment","fear","greed","crypto","index"}',
  '[{"clientDefinition":{"id":"fear-greed-001","name":"FearAndGreedIndex","description":"Fetches and displays the current Crypto Fear & Greed Index.","arguments":[],"body":"const r = await fetch(''https://api.alternative.me/fng/?limit=1'');\nif (!r.ok) throw new Error(''alternative.me failed: '' + r.status);\nconst d = await r.json();\nconst item = d.data[0];\nconst value = Number(item.value);\nconst label = item.value_classification;\nconst hue = Math.round(value * 1.2); // 0=red, 100=green\nconst html = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0b0d10;font-family:system-ui,sans-serif;color:#e5e7eb}</style></head><body><div style=\"text-align:center\"><div style=\"font-size:80px;font-weight:700;color:hsl(${hue},70%,55%)\">${value}</div><div style=\"font-size:22px;margin-top:4px;color:hsl(${hue},60%,65%)\">${label}</div><div style=\"margin-top:12px;font-size:14px;opacity:.5\">Crypto Fear &amp; Greed Index</div></div></body></html>`;\nreturn { contentType: ''text/html'', content: html };"},"type":"function","function":{"name":"FearAndGreedIndex","description":"Display the current Crypto Fear & Greed Index as a styled visual. Use when asked about market sentiment or the fear and greed index.","parameters":{"type":"object","properties":{}}}}]',
  true,
  null
),

(
  'Solana Token Lookup',
  'solana-token',
  'Look up a Solana token by mint address and return metadata + supply.',
  'crypto',
  '{"solana","token","spl","crypto"}',
  '[{"clientDefinition":{"id":"solana-token-001","name":"SolanaTokenLookup","description":"Returns metadata and supply for a Solana SPL token by mint address.","arguments":[{"name":"mint","type":"string","description":"Solana token mint address"}],"body":"const mint = String(args.mint || '''').trim();\nif (!mint) throw new Error(''mint required'');\nconst r = await fetch(''https://api.mainnet-beta.solana.com'', {\n  method: ''POST'',\n  headers: { ''content-type'': ''application/json'' },\n  body: JSON.stringify({\n    jsonrpc: ''2.0'', id: 1, method: ''getAccountInfo'',\n    params: [mint, { encoding: ''jsonParsed'' }]\n  })\n});\nif (!r.ok) throw new Error(''RPC failed: '' + r.status);\nconst d = await r.json();\nconst info = d.result?.value?.data?.parsed?.info;\nif (!info) throw new Error(''Not a token mint'');\nreturn {\n  mint,\n  decimals: info.decimals,\n  supply: info.supply,\n  freeze_authority: info.freezeAuthority,\n  mint_authority: info.mintAuthority\n};"},"type":"function","function":{"name":"SolanaTokenLookup","description":"Look up a Solana SPL token by its mint address to get decimals, supply, and authorities.","parameters":{"type":"object","properties":{"mint":{"type":"string","description":"Solana token mint address (base58)"}},"required":["mint"]}}}]',
  true,
  null
),

(
  'DeFi Protocol Stats',
  'defi-stats',
  'Fetch TVL and protocol stats for any DeFi protocol via DeFiLlama.',
  'crypto',
  '{"defi","tvl","defillama","crypto","protocol"}',
  '[{"clientDefinition":{"id":"defi-stats-001","name":"DeFiStats","description":"Returns TVL and category for a DeFi protocol from DeFiLlama.","arguments":[{"name":"protocol","type":"string","description":"Protocol slug e.g. uniswap, aave, lido, orca"}],"body":"const slug = encodeURIComponent(String(args.protocol || '''').trim().toLowerCase());\nif (!slug) throw new Error(''protocol required'');\nconst r = await fetch(''https://api.llama.fi/protocol/'' + slug);\nif (!r.ok) throw new Error(''DeFiLlama failed: '' + r.status);\nconst d = await r.json();\nreturn {\n  name: d.name,\n  category: d.category,\n  chain: d.chain,\n  tvl: d.tvl,\n  change_1d: d.change_1d,\n  change_7d: d.change_7d,\n  chains: d.chains?.slice(0, 5)\n};"},"type":"function","function":{"name":"DeFiStats","description":"Get TVL, category, and chain breakdown for any DeFi protocol from DeFiLlama. Use when asked about DeFi protocols, TVL, or on-chain activity.","parameters":{"type":"object","properties":{"protocol":{"type":"string","description":"DeFiLlama protocol slug (e.g. uniswap, aave, lido)"}},"required":["protocol"]}}}]',
  true,
  null
),

(
  'ENS Lookup',
  'ens-lookup',
  'Resolve an ENS name to an Ethereum address or reverse-resolve an address to ENS.',
  'crypto',
  '{"ens","ethereum","identity","crypto","web3"}',
  '[{"clientDefinition":{"id":"ens-lookup-001","name":"ENSLookup","description":"Resolves an ENS name to an address or reverse-resolves an address to ENS.","arguments":[{"name":"query","type":"string","description":"ENS name (e.g. vitalik.eth) or Ethereum address (0x...)"}],"body":"const q = String(args.query || '''').trim();\nif (!q) throw new Error(''query required'');\nconst isAddress = /^0x[0-9a-fA-F]{40}$/.test(q);\nconst endpoint = isAddress\n  ? `https://api.ensideas.com/ens/resolve/${encodeURIComponent(q)}`\n  : `https://api.ensideas.com/ens/resolve/${encodeURIComponent(q)}`;\nconst r = await fetch(endpoint);\nif (!r.ok) throw new Error(''ENS resolve failed: '' + r.status);\nconst d = await r.json();\nreturn { name: d.name, address: d.address, avatar: d.avatar };"},"type":"function","function":{"name":"ENSLookup","description":"Resolve an ENS name to its Ethereum address, or look up the ENS name for an address.","parameters":{"type":"object","properties":{"query":{"type":"string","description":"ENS name (e.g. vitalik.eth) or 0x Ethereum address"}},"required":["query"]}}}]',
  true,
  null
),

(
  'Wallet Balance',
  'wallet-balance',
  'Check ETH and ERC-20 token balances for any Ethereum address.',
  'crypto',
  '{"ethereum","wallet","balance","erc20","crypto"}',
  '[{"clientDefinition":{"id":"wallet-balance-001","name":"WalletBalance","description":"Returns ETH balance and top token balances for an Ethereum address.","arguments":[{"name":"address","type":"string","description":"Ethereum wallet address (0x...)"}],"body":"const addr = String(args.address || '''').trim();\nif (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error(''invalid Ethereum address'');\nconst r = await fetch(`https://api.etherscan.io/api?module=account&action=balance&address=${addr}&tag=latest`);\nif (!r.ok) throw new Error(''Etherscan failed: '' + r.status);\nconst d = await r.json();\nif (d.status !== ''1'') throw new Error(d.message || ''API error'');\nconst ethBalance = Number(d.result) / 1e18;\nreturn { address: addr, eth_balance: ethBalance };"},"type":"function","function":{"name":"WalletBalance","description":"Check the ETH balance for any Ethereum wallet address.","parameters":{"type":"object","properties":{"address":{"type":"string","description":"Ethereum wallet address starting with 0x"}},"required":["address"]}}}]',
  true,
  null
),

(
  'Crypto News',
  'crypto-news',
  'Fetch the latest crypto headlines from CryptoPanic.',
  'crypto',
  '{"news","headlines","crypto","sentiment"}',
  '[{"clientDefinition":{"id":"crypto-news-001","name":"CryptoNews","description":"Fetches the latest crypto news headlines.","arguments":[{"name":"filter","type":"string","description":"rising | hot | bullish | bearish | important | saved | lol (optional)"},{"name":"currencies","type":"string","description":"Comma-separated tickers e.g. BTC,ETH (optional)"}],"body":"const params = new URLSearchParams({ public: ''true'', auth_token: ''public'' });\nif (args.filter) params.set(''filter'', args.filter);\nif (args.currencies) params.set(''currencies'', args.currencies);\nconst r = await fetch(''https://cryptopanic.com/api/v1/posts/?'' + params);\nif (!r.ok) throw new Error(''CryptoPanic failed: '' + r.status);\nconst d = await r.json();\nconst items = (d.results || []).slice(0, 5).map(p => ({\n  title: p.title,\n  url: p.url,\n  published_at: p.published_at,\n  source: p.source?.title\n}));\nreturn items;"},"type":"function","function":{"name":"CryptoNews","description":"Get the latest crypto news headlines. Optionally filter by sentiment (bullish/bearish) or by coin ticker.","parameters":{"type":"object","properties":{"filter":{"type":"string","enum":["rising","hot","bullish","bearish","important"],"description":"News filter"},"currencies":{"type":"string","description":"Comma-separated tickers e.g. BTC,ETH"}}}}}]',
  true,
  null
)

on conflict (slug) do nothing;

commit;
