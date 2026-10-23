# MCP registry namespace decisions (io.github.nirholas)

Source of truth for the count: `curl "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.nirholas&version=latest&limit=100"`, following `metadata.next_cursor`. Measured 2026-10-23: 80 names, 54 backed by a local `server.json`, 26 registry-only.

Writes (owner-run, external publishes):

    node scripts/publish-mcp-servers.mjs --dry-run                 # prints every planned write
    node scripts/publish-mcp-servers.mjs --only solana-memo-media-mcp   # publish 0.1.1 to the registry
    node scripts/publish-mcp-servers.mjs --deprecate               # plan deprecations (dry run)
    node scripts/publish-mcp-servers.mjs --deprecate --apply       # write deprecations to registry and npm

## Decision table (registry-only names)

| Name | Decision | Reason |
|---|---|---|
| claude-code-explorer-mcp | Deprecate (in `DEPRECATIONS`) | Repository it points at is a takedown notice. |
| data-workbench-mcp | Deprecate (in `DEPRECATIONS`) | Source repository is gone; never republish code we cannot see. |
| abi-to-mcp | Leave | Lives in the UCAI repo; adopt when the MCP and agent tooling orders port it. |
| crypto-tools-registry | Leave | Lives in lyra-registry; same. |
| tool-discovery-mcp | Leave | Lives in lyra-tool-discovery; feeds the community skill source order. |
| repo-intel | Leave | Lives in lyra-intel. |
| solidity-compiler | Leave | Lives in lyra-web3-playground. |
| defi-agents | Leave | Own repo, source visible. |
| extract-llms-docs | Leave | Own repo, source visible. |
| github-to-mcp | Leave | Own repo, source visible. |
| mcp-notify | Leave | Own repo, source visible. |
| free-crypto-news | Leave | Own repo, source visible. |
| xactions | Leave | Own repo, source visible. |
| papertrade-ai | Leave | Own repo, source visible. |
| pump-fun-sdk | Leave | Own repo, source visible. |
| robinhood-mcp | Leave | Own repo; Robinhood Crypto connector is a deferred owner-gated order. |
| crypto-market-data | Leave | Duplicate of in-repo market data; harmless, source visible. |
| pumpfun-claims-bot | Leave | Source visible; dashboard runs on mock data upstream, so not promoted. |
| paired | Leave | Not promoted; stock-pairing product excluded by the playbook. |
| sperax-crypto-mcp | Leave | Third-party project name; source visible. |
| universal-crypto-mcp | Deprecate candidate | Off-strategy; owner decides. |
| ethereum-wallet-mcp, keystore-mcp-server, signing-mcp-server, transaction-mcp-server, validation-mcp-server | Deprecate candidates | Same ethereum-wallet-toolkit repo; key-generation liability, off-strategy for a Solana-first platform. Owner decides. |

Candidates are not in `DEPRECATIONS` because the registry has no un-deprecate guarantee for clients that cache status, and none has a lost source.
