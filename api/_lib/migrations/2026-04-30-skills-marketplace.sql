-- Migration: skills marketplace tables + seed data.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-30-skills-marketplace.sql
-- Idempotent.

-- ── marketplace_skills ───────────────────────────────────────────────────────
create table if not exists marketplace_skills (
    id            uuid primary key default gen_random_uuid(),
    author_id     uuid references users(id) on delete set null,
    name          text not null,
    slug          text not null unique,
    description   text not null,
    category      text not null default 'general',
    schema_json   jsonb not null,
    tags          text[] not null default '{}',
    is_public     boolean not null default true,
    install_count integer not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists marketplace_skills_category_idx on marketplace_skills(category);
create index if not exists marketplace_skills_author_idx   on marketplace_skills(author_id);
create index if not exists marketplace_skills_popular_idx  on marketplace_skills(install_count desc);
create index if not exists marketplace_skills_new_idx      on marketplace_skills(created_at desc);

-- ── skill_installs ───────────────────────────────────────────────────────────
create table if not exists skill_installs (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid references users(id) on delete cascade,
    skill_id     uuid references marketplace_skills(id) on delete cascade,
    installed_at timestamptz not null default now(),
    unique (user_id, skill_id)
);

create index if not exists skill_installs_user_idx on skill_installs(user_id);

-- ── skill_ratings ────────────────────────────────────────────────────────────
create table if not exists skill_ratings (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid references users(id) on delete cascade,
    skill_id   uuid references marketplace_skills(id) on delete cascade,
    rating     smallint not null check (rating between 1 and 5),
    created_at timestamptz not null default now(),
    unique (user_id, skill_id)
);

-- ── updated_at trigger ───────────────────────────────────────────────────────
do $$ begin
    create trigger marketplace_skills_set_updated_at before update on marketplace_skills
        for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ── seed data — system skills translated from chat/src/tools.js curatedToolPacks ──
insert into marketplace_skills (author_id, name, slug, description, category, schema_json, tags, is_public) values

(
    null,
    'TradingView Charts',
    'tradingview',
    'Display interactive TradingView price charts for any symbol.',
    'finance',
    $json$[
      {
        "clientDefinition": {
          "id": "tradingview-chart-001",
          "name": "TradingViewChart",
          "description": "Displays an interactive TradingView chart for a given symbol.",
          "arguments": [
            {"name": "symbol",   "type": "string", "description": "Trading symbol e.g. BINANCE:BTCUSDT, NASDAQ:AAPL"},
            {"name": "interval", "type": "string", "description": "Chart interval: 1, 5, 15, 30, 60, D, W, M"},
            {"name": "theme",    "type": "string", "description": "light or dark"}
          ],
          "body": "const symbol = args.symbol || 'BINANCE:BTCUSDT';\nconst interval = args.interval || 'D';\nconst theme = args.theme || 'light';\nconst html = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;height:100%;overflow:hidden}</style></head><body><div id=\"tv_chart\" style=\"width:100%;height:100vh\"></div><script src=\"https://s3.tradingview.com/tv.js\"><\\/script><script>new TradingView.widget({container_id:\"tv_chart\",symbol:${JSON.stringify(symbol)},interval:${JSON.stringify(interval)},theme:${JSON.stringify(theme)},style:\"1\",width:\"100%\",height:\"100%\",toolbar_bg:\"#f1f3f6\",hide_side_toolbar:false,allow_symbol_change:true});<\\/script></body></html>`;\nreturn { contentType: 'text/html', content: html };"
        },
        "type": "function",
        "function": {
          "name": "TradingViewChart",
          "description": "Display an interactive TradingView chart. Use for any request to show a price chart, candlestick chart, or market data visualization.",
          "parameters": {
            "type": "object",
            "properties": {
              "symbol":   {"type": "string", "description": "Trading symbol e.g. BINANCE:BTCUSDT, NASDAQ:AAPL, FX:EURUSD"},
              "interval": {"type": "string", "enum": ["1","5","15","30","60","D","W","M"], "description": "Chart interval"},
              "theme":    {"type": "string", "enum": ["light","dark"], "description": "Chart theme"}
            },
            "required": ["symbol"]
          }
        }
      }
    ]$json$::jsonb,
    '{charts,finance,tradingview}',
    true
),

(
    null,
    'Web Search',
    'web-search',
    'Search the web via DuckDuckGo and return a summary and top results.',
    'utilities',
    $json$[
      {
        "clientDefinition": {
          "id": "pack-websearch-001",
          "name": "WebSearch",
          "description": "Search the web via DuckDuckGo.",
          "arguments": [
            {"name": "query", "type": "string", "description": "Search query"}
          ],
          "body": "const res = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(args.query) + '&format=json&no_html=1');\nconst d = await res.json();\nconst topics = (d.RelatedTopics || []).slice(0, 3).map(t => t.Text).filter(Boolean);\nreturn JSON.stringify({ abstract: d.AbstractText || '', topics });"
        },
        "type": "function",
        "function": {
          "name": "WebSearch",
          "description": "Search the web via DuckDuckGo and return an abstract and top related topics.",
          "parameters": {
            "type": "object",
            "properties": {
              "query": {"type": "string", "description": "Search query"}
            },
            "required": ["query"]
          }
        }
      }
    ]$json$::jsonb,
    '{search,web,utilities}',
    true
),

(
    null,
    'Date & Time',
    'date-time',
    'Get the current time and timezone.',
    'utilities',
    $json$[
      {
        "clientDefinition": {
          "id": "pack-datetime-001",
          "name": "GetCurrentTime",
          "description": "Returns the current date and time as an ISO string.",
          "arguments": [],
          "body": "return new Date().toISOString();"
        },
        "type": "function",
        "function": {
          "name": "GetCurrentTime",
          "description": "Returns the current date and time as an ISO 8601 string.",
          "parameters": {"type": "object", "properties": {}}
        }
      },
      {
        "clientDefinition": {
          "id": "pack-datetime-002",
          "name": "GetTimezone",
          "description": "Returns the user's current timezone.",
          "arguments": [],
          "body": "return Intl.DateTimeFormat().resolvedOptions().timeZone;"
        },
        "type": "function",
        "function": {
          "name": "GetTimezone",
          "description": "Returns the user's current IANA timezone string.",
          "parameters": {"type": "object", "properties": {}}
        }
      }
    ]$json$::jsonb,
    '{time,date,utilities}',
    true
),

(
    null,
    'Wallet Transactions',
    'wallet-transactions',
    'Send and swap tokens on Solana and EVM chains directly from chat. Supports SOL, SPL tokens, ETH, ERC20, and DEX swaps via Jupiter and 1inch.',
    'crypto',
    $json$[
      {
        "clientDefinition": {
          "id": "solana-transfer-013",
          "name": "solana_transfer",
          "description": "Send SOL or a Solana SPL token (e.g. USDC) to a recipient address. Requires a connected Solana wallet.",
          "arguments": [
            {"name": "recipient", "type": "string", "description": "Base58 recipient wallet address"},
            {"name": "amount",    "type": "number", "description": "Amount to send in human-readable units (e.g. 1.5 for 1.5 SOL)"},
            {"name": "token",     "type": "string", "description": "Token to send: SOL or an SPL mint address. Default: SOL"},
            {"name": "memo",      "type": "string", "description": "Optional memo string to attach"},
            {"name": "network",   "type": "string", "description": "mainnet or devnet. Default: mainnet"}
          ],
          "body": "const _token = args.token || 'SOL';\nconst _network = args.network || 'mainnet';\nconst wallet = window.__wallet;\nif (!wallet || wallet.type !== 'solana') throw new Error('No Solana wallet connected. Please connect a Solana wallet first.');\nconst buildRes = await fetch('/api/tx/solana/build-transfer', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  credentials: 'include',\n  body: JSON.stringify({ sender: wallet.address, recipient: args.recipient, amount: args.amount, token: _token, memo: args.memo, network: _network }),\n});\nif (!buildRes.ok) {\n  const err = await buildRes.json().catch(() => ({}));\n  throw new Error(err.message || 'Failed to build transaction');\n}\nconst { transaction: txBase64 } = await buildRes.json();\nawait window.requestWalletApproval({\n  network: _network === 'devnet' ? 'Solana Devnet' : 'Solana',\n  from: wallet.address,\n  to: args.recipient,\n  amount: String(args.amount),\n  token: _token,\n  memo: args.memo,\n});\nconst txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));\nif (!window.solana.signAndSendTransaction) throw new Error('Wallet does not support signAndSendTransaction');\nconst { Transaction } = await import('https://esm.sh/@solana/web3.js@1');\nconst tx = Transaction.from(txBytes);\nconst result = await window.solana.signAndSendTransaction(tx);\nconst signature = result.signature;\nconst explorerUrl = 'https://solscan.io/tx/' + signature + (_network === 'devnet' ? '?cluster=devnet' : '');\nreturn { contentType: 'application/tx-result', content: { status: 'success', txHash: signature, network: _network === 'devnet' ? 'Solana Devnet' : 'Solana', from: wallet.address, to: args.recipient, amount: String(args.amount), token: _token, explorerUrl } };"
        },
        "type": "function",
        "function": {
          "name": "solana_transfer",
          "description": "Send SOL or SPL tokens on Solana. Requires a connected Solana wallet.",
          "parameters": {
            "type": "object",
            "properties": {
              "recipient": {"type": "string", "description": "Base58 recipient wallet address"},
              "amount":    {"type": "number", "description": "Amount in human-readable units"},
              "token":     {"type": "string", "description": "SOL or SPL mint address. Default: SOL"},
              "memo":      {"type": "string", "description": "Optional memo"},
              "network":   {"type": "string", "enum": ["mainnet","devnet"], "description": "Default: mainnet"}
            },
            "required": ["recipient", "amount"]
          }
        }
      },
      {
        "clientDefinition": {
          "id": "solana-swap-014",
          "name": "solana_swap",
          "description": "Swap tokens on Solana via Jupiter aggregator. Finds the best route automatically. Requires a connected Solana wallet.",
          "arguments": [
            {"name": "inputMint",   "type": "string", "description": "Mint address of the token to sell"},
            {"name": "outputMint",  "type": "string", "description": "Mint address of the token to buy"},
            {"name": "amount",      "type": "number", "description": "Amount of input token in human-readable units"},
            {"name": "slippageBps", "type": "number", "description": "Max slippage in basis points (100 = 1%). Default: 50"}
          ],
          "body": "const _slippageBps = args.slippageBps || 50;\nconst wallet = window.__wallet;\nif (!wallet || wallet.type !== 'solana') throw new Error('No Solana wallet connected.');\nconst buildRes = await fetch('/api/tx/solana/build-swap', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  credentials: 'include',\n  body: JSON.stringify({ sender: wallet.address, inputMint: args.inputMint, outputMint: args.outputMint, amount: args.amount, slippageBps: _slippageBps }),\n});\nif (!buildRes.ok) {\n  const err = await buildRes.json().catch(() => ({}));\n  throw new Error(err.message || 'Failed to get swap route');\n}\nconst { transaction: txBase64, outputAmount, priceImpactPct } = await buildRes.json();\nawait window.requestWalletApproval({\n  network: 'Solana',\n  from: wallet.address,\n  to: 'Jupiter (DEX aggregator)',\n  amount: String(args.amount),\n  token: args.inputMint.slice(0, 6) + '... -> ' + args.outputMint.slice(0, 6) + '...',\n  memo: '~' + outputAmount + ' out, ' + priceImpactPct + '% price impact',\n});\nconst txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));\nconst { Transaction } = await import('https://esm.sh/@solana/web3.js@1');\nconst tx = Transaction.from(txBytes);\nconst result = await window.solana.signAndSendTransaction(tx);\nconst signature = result.signature;\nreturn { contentType: 'application/tx-result', content: { status: 'success', txHash: signature, network: 'Solana', from: wallet.address, to: args.outputMint, amount: String(outputAmount), token: args.outputMint.slice(0, 8) + '...', explorerUrl: 'https://solscan.io/tx/' + signature } };"
        },
        "type": "function",
        "function": {
          "name": "solana_swap",
          "description": "Swap tokens on Solana via Jupiter. Best-route aggregation.",
          "parameters": {
            "type": "object",
            "properties": {
              "inputMint":   {"type": "string", "description": "Mint address of token to sell"},
              "outputMint":  {"type": "string", "description": "Mint address of token to buy"},
              "amount":      {"type": "number", "description": "Amount of input token in human-readable units"},
              "slippageBps": {"type": "number", "description": "Max slippage in bps. Default: 50"}
            },
            "required": ["inputMint", "outputMint", "amount"]
          }
        }
      },
      {
        "clientDefinition": {
          "id": "evm-transfer-015",
          "name": "evm_transfer",
          "description": "Send ETH or an ERC20 token to a recipient address on any EVM chain. Requires a connected EVM wallet.",
          "arguments": [
            {"name": "recipient", "type": "string", "description": "0x recipient address"},
            {"name": "amount",    "type": "string", "description": "Amount in human-readable units (e.g. 0.01 for 0.01 ETH)"},
            {"name": "token",     "type": "string", "description": "ETH for native token, or an ERC20 contract address. Default: ETH"},
            {"name": "decimals",  "type": "number", "description": "Token decimals (required for ERC20, ignored for ETH). Default: 18"}
          ],
          "body": "const wallet = window.__wallet;\nif (!wallet || wallet.type !== 'evm') throw new Error('No EVM wallet connected. Please connect MetaMask or a compatible wallet.');\nconst _token = args.token || 'ETH';\nconst _decimals = args.decimals !== undefined ? args.decimals : 18;\nconst chainNames = { 1: 'Ethereum', 8453: 'Base', 10: 'Optimism', 42161: 'Arbitrum', 137: 'Polygon' };\nconst networkName = chainNames[wallet.chainId] || 'Chain ' + wallet.chainId;\nawait window.requestWalletApproval({ network: networkName, from: wallet.address, to: args.recipient, amount: args.amount, token: _token === 'ETH' ? 'ETH' : _token.slice(0, 8) + '...' });\nlet txHash;\nif (_token === 'ETH') {\n  const valueHex = '0x' + BigInt(Math.round(parseFloat(args.amount) * 1e18)).toString(16);\n  txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: wallet.address, to: args.recipient, value: valueHex }] });\n} else {\n  const amountBigInt = BigInt(Math.round(parseFloat(args.amount) * 10 ** _decimals));\n  const paddedTo = args.recipient.slice(2).padStart(64, '0');\n  const paddedAmount = amountBigInt.toString(16).padStart(64, '0');\n  txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: wallet.address, to: _token, data: '0xa9059cbb' + paddedTo + paddedAmount }] });\n}\nconst explorerBases = { 1: 'https://etherscan.io/tx/', 8453: 'https://basescan.org/tx/', 10: 'https://optimistic.etherscan.io/tx/', 42161: 'https://arbiscan.io/tx/', 137: 'https://polygonscan.com/tx/' };\nconst explorerUrl = (explorerBases[wallet.chainId] || 'https://etherscan.io/tx/') + txHash;\nreturn { contentType: 'application/tx-result', content: { status: 'pending', txHash, network: networkName, chainId: wallet.chainId, from: wallet.address, to: args.recipient, amount: args.amount, token: _token === 'ETH' ? 'ETH' : _token.slice(0, 10) + '...', explorerUrl } };"
        },
        "type": "function",
        "function": {
          "name": "evm_transfer",
          "description": "Send ETH or ERC20 tokens on any EVM chain (Ethereum, Base, Optimism, Arbitrum, Polygon).",
          "parameters": {
            "type": "object",
            "properties": {
              "recipient": {"type": "string", "description": "0x recipient address"},
              "amount":    {"type": "string", "description": "Amount in human-readable units"},
              "token":     {"type": "string", "description": "ETH or ERC20 contract address. Default: ETH"},
              "decimals":  {"type": "number", "description": "ERC20 decimals. Default: 18"}
            },
            "required": ["recipient", "amount"]
          }
        }
      },
      {
        "clientDefinition": {
          "id": "evm-swap-016",
          "name": "evm_swap",
          "description": "Swap tokens on EVM chains using 1inch aggregator. Finds best DEX route. Requires a connected EVM wallet.",
          "arguments": [
            {"name": "fromToken", "type": "string", "description": "Token contract address to sell (use 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE for native ETH)"},
            {"name": "toToken",   "type": "string", "description": "Token contract address to buy"},
            {"name": "amount",    "type": "string", "description": "Amount of fromToken in human-readable units"},
            {"name": "decimals",  "type": "number", "description": "Decimals of fromToken. Default: 18"},
            {"name": "slippage",  "type": "number", "description": "Max slippage percentage (e.g. 1 for 1%). Default: 1"}
          ],
          "body": "const wallet = window.__wallet;\nif (!wallet || wallet.type !== 'evm') throw new Error('No EVM wallet connected.');\nconst _decimals = args.decimals !== undefined ? args.decimals : 18;\nconst _slippage = args.slippage !== undefined ? args.slippage : 1;\nconst chainNames = { 1: 'Ethereum', 8453: 'Base', 10: 'Optimism', 42161: 'Arbitrum', 137: 'Polygon' };\nconst networkName = chainNames[wallet.chainId] || 'Chain ' + wallet.chainId;\nconst amountWei = BigInt(Math.round(parseFloat(args.amount) * 10 ** _decimals)).toString();\nconst quoteUrl = 'https://api.1inch.dev/swap/v5.2/' + wallet.chainId + '/swap?src=' + args.fromToken + '&dst=' + args.toToken + '&amount=' + amountWei + '&from=' + wallet.address + '&slippage=' + _slippage + '&disableEstimate=true';\nconst quoteRes = await fetch(quoteUrl, { headers: { 'Accept': 'application/json' } });\nif (!quoteRes.ok) {\n  const err = await quoteRes.json().catch(() => ({}));\n  throw new Error(err.description || 'Failed to get swap quote from 1inch');\n}\nconst quote = await quoteRes.json();\nconst toAmountHuman = (Number(quote.toAmount) / 10 ** 18).toFixed(6);\nawait window.requestWalletApproval({ network: networkName, from: wallet.address, to: '1inch Router', amount: args.amount, token: args.fromToken.slice(0,8) + '... -> ' + args.toToken.slice(0,8) + '...', memo: '~' + toAmountHuman + ' out' });\nconst ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';\nif (args.fromToken.toLowerCase() !== ETH_ADDRESS.toLowerCase()) {\n  const paddedOwner = wallet.address.slice(2).padStart(64, '0');\n  const paddedSpender = quote.tx.to.slice(2).padStart(64, '0');\n  const allowanceHex = await window.ethereum.request({ method: 'eth_call', params: [{ to: args.fromToken, data: '0xdd62ed3e' + paddedOwner + paddedSpender }, 'latest'] });\n  if (BigInt(allowanceHex || '0x0') < BigInt(amountWei)) {\n    await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: wallet.address, to: args.fromToken, data: '0x095ea7b3' + paddedSpender + 'f'.repeat(64) }] });\n  }\n}\nconst txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: wallet.address, to: quote.tx.to, data: quote.tx.data, value: quote.tx.value || '0x0' }] });\nconst explorerBases = { 1: 'https://etherscan.io/tx/', 8453: 'https://basescan.org/tx/', 10: 'https://optimistic.etherscan.io/tx/', 42161: 'https://arbiscan.io/tx/', 137: 'https://polygonscan.com/tx/' };\nconst explorerUrl = (explorerBases[wallet.chainId] || 'https://etherscan.io/tx/') + txHash;\nreturn { contentType: 'application/tx-result', content: { status: 'pending', txHash, network: networkName, chainId: wallet.chainId, from: wallet.address, to: args.toToken, amount: '~' + toAmountHuman, token: args.toToken.slice(0, 10) + '...', explorerUrl } };"
        },
        "type": "function",
        "function": {
          "name": "evm_swap",
          "description": "Swap ERC20 tokens or ETH on EVM chains via 1inch DEX aggregator.",
          "parameters": {
            "type": "object",
            "properties": {
              "fromToken": {"type": "string", "description": "Token to sell (address or 0xEeee... for ETH)"},
              "toToken":   {"type": "string", "description": "Token to buy (address)"},
              "amount":    {"type": "string", "description": "Amount of fromToken in human-readable units"},
              "decimals":  {"type": "number", "description": "fromToken decimals. Default: 18"},
              "slippage":  {"type": "number", "description": "Max slippage %. Default: 1"}
            },
            "required": ["fromToken", "toToken", "amount"]
          }
        }
      }
    ]$json$::jsonb,
    '{crypto,solana,evm,defi,wallet}',
    true
),

(
    null,
    'QR Code',
    'qr-code',
    'Generate a QR code image for any text or URL.',
    'utilities',
    $json$[
      {
        "clientDefinition": {
          "id": "qr-code-001",
          "name": "QRCode",
          "description": "Generates a QR code image for any text or URL.",
          "arguments": [
            {"name": "text", "type": "string", "description": "Text or URL to encode as a QR code"}
          ],
          "body": "const encoded = encodeURIComponent(args.text);\nconst url = 'https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=' + encoded;\nreturn { contentType: 'text/html', content: '<div style=\"text-align:center;padding:16px\"><img src=\"' + url + '\" style=\"max-width:256px\" alt=\"QR Code\"><p style=\"font-family:monospace;font-size:12px;word-break:break-all\">' + args.text + '</p></div>' };"
        },
        "type": "function",
        "function": {
          "name": "QRCode",
          "description": "Generates and displays a QR code for the given text or URL.",
          "parameters": {
            "type": "object",
            "properties": {
              "text": {"type": "string", "description": "Text or URL to encode as QR code"}
            },
            "required": ["text"]
          }
        }
      }
    ]$json$::jsonb,
    '{qr,encode,url,utilities}',
    true
)

on conflict (slug) do nothing;
