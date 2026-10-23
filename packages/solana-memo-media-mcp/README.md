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
| `extract_solana_memo_media` | Fetch one legacy, v0, or v1 transaction and return every supported image in its top-level and inner Memo instructions, with signer, slot, and version. |
| `find_solana_memo_media` | Scan up to 1,000 recent signatures for an address (pageable with `before`). Only signatures whose memo summary holds a data URI are fetched, so a scan costs a handful of RPC calls. |
| `decode_solana_memo_data_uri` | Decode one already-copied data URI locally. No network call. |
| `read_inscription` | Rebuild and verify a multi-part inscription (`first/1`, `firsts/1`, spl404) from any one of its transaction signatures. Images inline; SVG, HTML and text as inert text. |
| `get_solana_memo_media_status` | Show the local policy, recognized memo programs, and RPC failover hosts. No network call. |

Recognized memo programs: SPL Memo v1 (`Memo1UhkJRfHyvLMcVLMbLJYfW2tfU8G8H4PqvV6v8`), SPL Memo v2 (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`), and the newer program carried by version 1 transactions (`Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH`).

## Example

Ask an MCP client: "Show any image embedded in Solana transaction `<signature>`." It calls `extract_solana_memo_media` with:

```json
{ "signature": "<base58 Solana transaction signature>" }
```

The response is a JSON record plus one MCP `image` content block per asset. The record carries the signature, fee payer, slot, transaction version, and for each asset its MIME type, byte length, SHA-256, and dimensions. The raw data URI is intentionally not echoed into text output.

Use it from your own code:

```js
import { decodeDataUri } from '@three-ws/solana-memo-media-mcp/src/lib/media.js';

const media = decodeDataUri('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwV8YQAAAABJRU5ErkJggg==');
console.log(media.mimeType, media.byteLength, media.dimensions, media.sha256);
```

Full guide: [docs/mcp-solana-memo-media.md](../../docs/mcp-solana-memo-media.md).

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
