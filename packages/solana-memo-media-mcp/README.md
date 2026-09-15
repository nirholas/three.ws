# @three-ws/solana-memo-media-mcp

Read and display image data URIs embedded in Solana SPL Memo instructions. Instead of copying a `data:image/...;base64,...` memo payload into a browser converter, give an AI assistant the transaction signature and receive the validated image inline.

This is a keyless, read-only stdio MCP server. It never signs, sends, uploads, caches, or modifies chain data.

## Install

```bash
claude mcp add solana-memo-media -- npx -y @three-ws/solana-memo-media-mcp
```

For Cursor, Claude Desktop, or another stdio MCP client:

```json
{
  "mcpServers": {
    "solana-memo-media": {
      "command": "npx",
      "args": ["-y", "@three-ws/solana-memo-media-mcp"]
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `extract_solana_memo_media` | Fetch one finalized transaction and extract supported image data URIs from top-level and inner Memo instructions. |
| `decode_solana_memo_data_uri` | Decode one already-copied data URI locally. No network call. |
| `find_solana_memo_media` | Inspect up to 20 recent finalized transactions for an address and return matching memo media. |
| `get_solana_memo_media_status` | Show the local policy and RPC failover hosts. No network call. |

## Example

Ask an MCP client: "Show any image embedded in Solana transaction `<signature>`." It calls:

```json
{ "signature": "<base58 Solana transaction signature>" }
```

The response includes a concise JSON record plus MCP `image` content. JSON metadata contains the source signature, MIME type, byte length, SHA-256, and dimensions when the file format exposes them. The raw data URI is intentionally not echoed into text output.

## Safety and provenance

An SPL Memo is arbitrary signed text. A data URI is only a convention inside that text, not a Solana media standard and not an endorsement by a wallet, explorer, or this package.

- Only `image/png`, `image/jpeg`, `image/webp`, and `image/gif` are accepted.
- SVG and all executable or document media are rejected.
- Decoded content is capped at 262,144 bytes.
- The declared MIME type must match PNG, JPEG, WebP, or GIF file signatures before an image is returned.
- The server reports a SHA-256 digest so callers can preserve an exact reference.
- Verify the transaction signer, program, and surrounding transaction context independently before trusting what an image means.

## RPC configuration

The server tries `SOLANA_RPC_URLS`, then `SOLANA_RPC_URL`, then public Solana mainnet endpoints. You do not need a key for normal use.

| Variable | Required | Meaning |
| --- | --- | --- |
| `SOLANA_RPC_URLS` | no | Comma-separated ordered JSON-RPC failover endpoints. |
| `SOLANA_RPC_URL` | no | One primary JSON-RPC endpoint. |

## Development

```bash
npm test --prefix packages/solana-memo-media-mcp
npx -y @modelcontextprotocol/inspector node packages/solana-memo-media-mcp/src/index.js
```

License: Apache-2.0.
