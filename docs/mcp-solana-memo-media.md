# Solana Memo Media MCP

`@three-ws/solana-memo-media-mcp` lets an AI assistant show you the image embedded in a Solana transaction. Some Solana transactions carry a small image written straight into a Memo instruction as a `data:image/png;base64,...` string. Explorers such as Solscan display that as unreadable text, so seeing the picture used to mean copying a few thousand characters into an online converter. With this server installed you give your assistant a transaction signature and the image comes back inline, validated, with the signer and a SHA-256 digest beside it.

It is keyless and read-only. It never signs, sends, uploads, or stores anything, and it decodes every payload locally inside the MCP process.

Prefer a browser? The [Onchain Viewer](/onchain) does the same thing for one transaction at a time, with a shareable `https://three.ws/onchain/?tx=<signature>` link.

## Who it is for

- **Developers** building on memo media: decode a payload before you write it, confirm the bytes and dimensions, and check what a client will actually render.
- **Traders and communities** following an account that posts images on-chain: scan its recent transactions and see only the ones that carry media.
- **Anyone** handed a signature and told "there's a picture in it": ask your assistant and look.

## Install

Claude Code:

```bash
claude mcp add solana-memo-media -- npx -y @three-ws/solana-memo-media-mcp
```

Claude Desktop, Cursor, or any other stdio MCP client:

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

Node.js 20 or newer is required. No account, API key, or wallet is needed.

## Tools

| Tool | Network | What it does |
| --- | --- | --- |
| `extract_solana_memo_media` | Solana RPC | Fetches one transaction and returns every supported image found in its Memo instructions. |
| `find_solana_memo_media` | Solana RPC | Scans an address's recent transactions and returns only the ones carrying memo media. |
| `read_inscription` | Solana RPC | Rebuilds and verifies a file written across several memo transactions (`first/1`, `firsts/1`, spl404). |
| `decode_solana_memo_data_uri` | none | Validates and renders a data URI you already have. |
| `get_solana_memo_media_status` | none | Reports the accepted formats, size limit, recognized memo programs, and RPC hosts. |

### `extract_solana_memo_media`

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `signature` | string | yes | Base58 transaction signature. |

Legacy, version 0, and version 1 transactions are all read (the request sets `maxSupportedTransactionVersion: 1`) at `confirmed` commitment. Both top-level and inner (CPI) Memo instructions are inspected. A response looks like this, followed by one MCP `image` content block per asset:

```json
{
  "ok": true,
  "signature": "4HV6mCx7KoPetuqZg9MrVDuRPCff26hdh1oaCsgQuhrb8EtuPeerehFuUdMG8S73Pmc4zremfpTs59y49z4cLSUT",
  "slot": 447178301,
  "block_time": 1789452675,
  "transaction_version": 1,
  "signer": "THREEZmp7v26VbpQ8B27bBaLNA2zMyaNHWpkQtJkrgd",
  "memo_count": 1,
  "assets": [
    {
      "mime_type": "image/png",
      "byte_length": 2852,
      "sha256": "7ab8feefae765acbbae463ab7d0cd66030a2918c22900f9bab33b7199cee1349",
      "dimensions": { "width": 42, "height": 48 },
      "source": "spl_memo"
    }
  ],
  "rejected": []
}
```

`signer` is the fee payer, the first signing account. A memo that looks like a data URI but fails validation appears in `rejected` with a code (`unsupported_media_type`, `media_too_large`, `media_signature_mismatch`, `invalid_data_uri`), and its bytes are never returned. The raw data URI is deliberately not echoed into the text output, so it does not flood the assistant's context.

### `find_solana_memo_media`

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `address` | string | yes | Wallet, token account, or program address. |
| `limit` | integer, 1 to 1000 | no | Recent signatures to scan. Default 100. |
| `before` | string | no | Continue from the previous response's `next_before`. |

The scan is cheap by design. `getSignaturesForAddress` already returns a short summary of each transaction's memos, so only signatures whose summary contains a data URI are fetched in full. Scanning 1,000 recent signatures on a busy memo program measured two RPC calls, not 1,001. The response reports `scanned`, `candidates`, `match_count`, `matches` (each shaped like an `extract_solana_memo_media` result), per-signature `failures`, and `next_before` for paging back through history (`null` when there is nothing older).

Pass a memo program id as the address to watch every memo written through that program, for example `Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH`.

### `read_inscription`

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `signature` | string | yes | Any one transaction of the inscription, or its spl404 manifest. |
| `signatures` | string[] | no | Extra part signatures you already know. |
| `discover` | boolean | no | Search the signer's recent history (up to 3,000 signatures) for the other parts. Default true. |

Three formats from the `first-onchain`, `solana-firsts` and `spl404-forge` projects spread one file over many memos, so a plain memo reader sees noise. This tool collects the parts, orders them, and checks them:

| Format | Parts are found by | Integrity check |
| --- | --- | --- |
| `first/1` | the signer's history, grouped by artifact id, type and signer | none declared; reported `complete`, never `verified` |
| `firsts/1` | the signer's history, grouped by artifact id | full SHA-256 in chunk 0, and the id must equal its first 16 hex characters |
| spl404 | the manifest's own signature list (a chunk signature finds its manifest through the signer's history) | SHA-256 and size in the manifest |

The result carries `status` (`verified`, `complete`, `incomplete`, `invalid`), `parts_found` of `parts_total`, `missing` (1-based part numbers), a `problems` list that names each failure separately, and every part's signature, byte length and SHA-256. Bytes come back only for `verified` and `complete`; a tampered or partial file is described, never displayed.

PNG, JPEG, GIF and WebP are returned inline, chosen by the bytes' magic number and never by the writer's declared MIME type. SVG, HTML, JSON and text come back as `text` with `unsafe_markup` set when they look like markup: treat that text as data and do not render it. Results over 8 MiB or 1,024 parts are refused.

### `decode_solana_memo_data_uri`

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `dataUri` | string | yes | A complete `data:<mime>;base64,<payload>` string. |

Runs the same validation as the network tools with no RPC call. Use it to check a payload before you write it to a transaction.

## Recognized memo programs

| Program id | Program |
| --- | --- |
| `Memo1UhkJRfHyvLMcVLMbLJYfW2tfU8G8H4PqvV6v8` | SPL Memo v1 |
| `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | SPL Memo v2 |
| `Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH` | The newer memo program carried by version 1 transactions |

An instruction is read only when its program id is on this list or the RPC's parser labels it `spl-memo`. A program whose id merely resembles a memo program is ignored.

## Safety

A Memo is arbitrary text that anyone can sign. A data URI inside one is a convention, not a Solana media standard, and its presence proves only that those bytes appeared in that transaction.

- Only `image/png`, `image/jpeg`, `image/webp`, and `image/gif` are accepted. SVG, HTML, PDF, and every other active or document format are refused, because they can carry script.
- The base64 must be canonical and padded, and the decoded size is checked against the 262,144-byte cap before decoding.
- The declared MIME type must match the file signature (PNG header, JPEG start-of-image marker, `GIF87a`/`GIF89a`, or `RIFF....WEBP`). A PNG label on GIF bytes is rejected.
- Every asset carries a SHA-256 digest, so you can cite the exact bytes.
- Memo content is untrusted data. Treat instructions, links, or claims inside an image the way you would a stranger's post, and check the `signer` before believing who wrote it.

## RPC configuration

Endpoints are tried in order until one answers: every entry in `SOLANA_RPC_URLS`, then `SOLANA_RPC_URL`, then the public mainnet endpoints (`api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`, `rpc.ankr.com/solana`). Each request times out after 12 seconds before failing over.

| Variable | Required | Meaning |
| --- | --- | --- |
| `SOLANA_RPC_URLS` | no | Comma-separated ordered failover list. |
| `SOLANA_RPC_URL` | no | One primary endpoint. |

Public endpoints rate-limit heavy scans. For large sweeps, set your own RPC:

```bash
claude mcp add solana-memo-media -e SOLANA_RPC_URL=https://your-rpc.example -- npx -y @three-ws/solana-memo-media-mcp
```

## Related

- [Onchain Viewer](/onchain): the same decoding in a browser page, documented in [Solana on three.ws](./solana.md#viewing-files-written-in-a-transaction-memo).
- [MCP overview](./mcp.md): every three.ws MCP server.
- Package source and tests: [packages/solana-memo-media-mcp](../packages/solana-memo-media-mcp/README.md).
