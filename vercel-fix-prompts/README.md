# Vercel Fix Prompts — 3D Agent

Generated from log export `3dagent-log-export-2026-05-01T02-15-25.json`.
Run each file as a new chat session in order of priority.

## CRITICAL — Run First (deploy-blocking or highest volume)

| # | File | Issue | Volume |
|---|------|--------|--------|
| 01 | [01-missing-zauthx402-sdk.md](01-missing-zauthx402-sdk.md) | `@zauthx402/sdk` not bundled in deployment | 837+ instances |
| 02 | [02-missing-jwt-secret-env-var.md](02-missing-jwt-secret-env-var.md) | `JWT_SECRET` env var missing in Vercel | 500 errors on auth routes |
| 06 | [06-missing-sub-module.md](06-missing-sub-module.md) | `api/agents/_sub.js` missing from deployment | 2,892 instances |
| 14 | [14-null-reference-permissions-action.md](14-null-reference-permissions-action.md) | Process crash (exit 1) on `null.topicHash` | 250+ crashes |

## HIGH — Database Issues

| # | File | Issue | Volume |
|---|------|--------|--------|
| 03 | [03-missing-database-tables.md](03-missing-database-tables.md) | 4 missing DB tables (incomplete migrations) | 500 errors |
| 04 | [04-missing-avatars-columns.md](04-missing-avatars-columns.md) | 2 missing columns on `avatars` table | 500 errors |
| 05 | [05-invalid-uuid-routing.md](05-invalid-uuid-routing.md) | `index.html`, `pumpfun` passed as UUID params | 963+ instances |
| 07 | [07-duplicate-email-key-violation.md](07-duplicate-email-key-violation.md) | INSERT fails for returning users (no upsert) | 500 on SIWE verify |

## HIGH — RPC Configuration

| # | File | Issue | Volume |
|---|------|--------|--------|
| 11 | [11-rpc-missing-chain-configs.md](11-rpc-missing-chain-configs.md) | No RPC URL for chains 8453, 421614, 11155420 | 560+ per chain |
| 12 | [12-rpc-rate-limiting-strategy.md](12-rpc-rate-limiting-strategy.md) | RPC 429 rate limiting from Solana + ETH providers | 31+ instances |
| 18 | [18-rpc-block-range-beyond-head.md](18-rpc-block-range-beyond-head.md) | `eth_getLogs` toBlock exceeds chain head | Cron failures |
| 19 | [19-rpc-operation-aborted-timeouts.md](19-rpc-operation-aborted-timeouts.md) | RPC calls aborted/timed out on Sepolia | 2,770+ instances |

## MEDIUM — Package/Dependency Issues

| # | File | Issue | Volume |
|---|------|--------|--------|
| 08 | [08-noble-curves-package-export.md](08-noble-curves-package-export.md) | `@noble/curves` missing `./ed25519` subpath export | 500 on SIWS verify |
| 09 | [09-bonfida-spl-name-service-syntax-error.md](09-bonfida-spl-name-service-syntax-error.md) | Syntax error in `@bonfida/spl-name-service` ESM bundle | 500 on pump-fun-mcp |
| 10 | [10-pump-sdk-esm-cjs-mismatch.md](10-pump-sdk-esm-cjs-mismatch.md) | `@pump-fun/pump-sdk` ESM loading failure | 500 on agents/[id] |

## MEDIUM — Runtime Issues

| # | File | Issue | Volume |
|---|------|--------|--------|
| 13 | [13-vercel-timeout-erc8004-crawl.md](13-vercel-timeout-erc8004-crawl.md) | Cron job exceeds Vercel 300s timeout | 504 Gateway Timeout |
| 15 | [15-type-error-solana-register-prep.md](15-type-error-solana-register-prep.md) | TypeError: wrong type passed to Buffer/crypto call | 500 on solana-register |
| 17 | [17-http-403-erc8004-register-confirm.md](17-http-403-erc8004-register-confirm.md) | Upstream returns 403, crashes as unhandled 500 | 500 on register-confirm |

## LOW — Deprecation Warnings (cleanup)

| # | File | Issue | Volume |
|---|------|--------|--------|
| 16 | [16-deprecated-url-parse.md](16-deprecated-url-parse.md) | `url.parse()` deprecated — use WHATWG URL API | 474+ warnings |
| 20 | [20-deprecated-fetchconnectioncache.md](20-deprecated-fetchconnectioncache.md) | `fetchConnectionCache` deprecated option in web3 | Multiple warnings |
