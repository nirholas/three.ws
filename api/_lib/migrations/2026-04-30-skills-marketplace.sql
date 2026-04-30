-- Migration: skills marketplace tables.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-30-skills-marketplace.sql

-- ── marketplace_skills ───────────────────────────────────────────────────────
create table marketplace_skills (
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

create index marketplace_skills_category_idx on marketplace_skills(category);
create index marketplace_skills_author_idx   on marketplace_skills(author_id);
create index marketplace_skills_popular_idx  on marketplace_skills(install_count desc);
create index marketplace_skills_new_idx      on marketplace_skills(created_at desc);

-- ── skill_installs ───────────────────────────────────────────────────────────
create table skill_installs (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid references users(id) on delete cascade,
    skill_id     uuid references marketplace_skills(id) on delete cascade,
    installed_at timestamptz not null default now(),
    unique (user_id, skill_id)
);

create index skill_installs_user_idx on skill_installs(user_id);

-- ── skill_ratings ────────────────────────────────────────────────────────────
create table skill_ratings (
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
    'tradingview-charts',
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
          "body": "// see chat/src/tools.js → walletToolSchema solana_transfer"
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
          "body": "// see chat/src/tools.js → walletToolSchema solana_swap"
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
          "body": "// see chat/src/tools.js → walletToolSchema evm_transfer"
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
          "body": "// see chat/src/tools.js → walletToolSchema evm_swap"
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
)

on conflict (slug) do nothing;
