---
name: bitcoin-inscription-guide
description: Guide to Bitcoin inscriptions (Ordinals) — creating, minting, and managing content inscribed on the Bitcoin blockchain. Covers Ordinal theory, inscription types (text, images, HTML), BRC-20 tokens, recursive inscriptions, and marketplace integration.
license: MIT
metadata:
  category: protocol
  difficulty: intermediate
  author: nich
  tags: [protocol, bitcoin-inscription-guide]
---

# Bitcoin Inscription Guide

Bitcoin inscriptions (Ordinals) let you permanently embed content — text, images, HTML, code — directly on the Bitcoin blockchain. This guide covers the full lifecycle from creation to marketplace.

## What Are Inscriptions?

Inscriptions use the Ordinals protocol to embed arbitrary content into individual satoshis:

```
Bitcoin Transaction
    │
    └── Witness Data (SegWit)
            │
            └── Inscription Envelope
                    ├── Content-Type: "text/plain"
                    └── Body: "Hello, Bitcoin!"
```

## Inscription Types

| Type | Content-Type | Max Size | Use Case |
|------|-------------|----------|---------|
| **Text** | text/plain | ~390KB | Messages, poems, data |
| **Image** | image/png, image/webp | ~390KB | Art, pfps, memes |
| **HTML** | text/html | ~390KB | Interactive content |
| **SVG** | image/svg+xml | ~390KB | Vector art |
| **JSON** | application/json | ~390KB | BRC-20 tokens, metadata |
| **JavaScript** | text/javascript | ~390KB | Recursive inscriptions |
| **Audio** | audio/wav | ~390KB | Music |
| **Video** | video/mp4 | ~390KB | Short clips |

## Creating Inscriptions

### CLI Tool
```bash
# Install
npm install -g @nirholas/bitcoin-inscription

# Inscribe text
btc-inscribe text "Sperax <> Bitcoin" --fee-rate 10

# Inscribe image
btc-inscribe image ./my-art.png --fee-rate 10

# Inscribe HTML
btc-inscribe html ./interactive-art.html --fee-rate 10
```

### Programmatic
```typescript
import { Inscriber } from '@nirholas/bitcoin-inscription';

const inscriber = new Inscriber({
  network: 'mainnet',
  wallet: process.env.BTC_WALLET_WIF,
  feeRate: 10  // sats/vByte
});

// Inscribe text
const result = await inscriber.inscribeText('Hello from Sperax!');
console.log(`Inscription ID: ${result.inscriptionId}`);
console.log(`TX: ${result.txId}`);
```

## BRC-20 Tokens

BRC-20 is a token standard built on inscriptions:

### Deploy
```json
{
  "p": "brc-20",
  "op": "deploy",
  "tick": "SPAX",
  "max": "21000000",
  "lim": "1000"
}
```

### Mint
```json
{
  "p": "brc-20",
  "op": "mint",
  "tick": "SPAX",
  "amt": "1000"
}
```

### Transfer
```json
{
  "p": "brc-20",
  "op": "transfer",
  "tick": "SPAX",
  "amt": "500"
}
```

## Recursive Inscriptions

Inscriptions that reference other inscriptions:

```html
<!-- This HTML inscription references an image inscription -->
<html>
  <body>
    <img src="/content/abc123...inscriptionId" />
    <script src="/content/def456...jsLibInscriptionId"></script>
  </body>
</html>
```

This enables:
- On-chain libraries (inscribe jQuery once, reference from many)
- Generative art with shared rendering code
- Composable content

## Fee Estimation

```typescript
// Estimate inscription cost
const estimate = await inscriber.estimateFee({
  content: Buffer.from('Hello World'),
  contentType: 'text/plain',
  feeRate: 10
});

console.log(`Size: ${estimate.size} vBytes`);
console.log(`Fee: ${estimate.fee} sats ($${estimate.feeUSD})`);
console.log(`Total: ${estimate.total} sats`);
```

## Marketplace Integration

```typescript
// List inscription for sale
await inscriber.list({
  inscriptionId: 'abc123...',
  price: 100000,  // sats
  marketplace: 'magic-eden'  // or 'ordinals-wallet'
});

// Search inscriptions
const results = await inscriber.search({
  contentType: 'image/png',
  minSats: 1000,
  maxSats: 1000000,
  sort: 'newest'
});
```

## Links

- GitHub: https://github.com/nirholas/bitcoin-inscription
- Ordinals Protocol: https://docs.ordinals.com
- Ordinals Explorer: https://ordinals.com
- BRC-20: https://brc-20.io
- Sperax: https://app.sperax.io
