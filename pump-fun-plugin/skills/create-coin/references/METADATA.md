# Pump.fun coin metadata JSON

`createV2AndBuyInstructions` expects a **`uri`** pointing at a JSON document (usually hosted on IPFS). The pump.fun web app builds that JSON after uploading the image and metadata.

## Recommended JSON shape

Align with the fields the frontend sends when pinning metadata (see pump.fun app `metadataBuilder` / `api/ipfs` route):

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | string | Display name |
| `symbol` | string | Ticker |
| `description` | string | |
| `image` | string | HTTPS or `https://ipfs.io/ipfs/{cid}` |
| `showName` | boolean | Whether to show name on pump.fun |
| `createdOn` | string | e.g. `"https://pump.fun"` |
| `twitter` | string | Optional |
| `telegram` | string | Optional |
| `website` | string | Optional |
| `video` | string | Optional (app may use S3 URL for video) |

Example (minimal):

```json
{
  "name": "My Coin",
  "symbol": "MYC",
  "description": "Short description",
  "image": "https://ipfs.io/ipfs/bafybeiexample",
  "showName": true,
  "createdOn": "https://pump.fun"
}
```

## How to obtain `metadataUri`

1. **Your product:** Implement or reuse an upload flow (image → IPFS / object storage, then JSON → IPFS) and pass the final JSON URL to `scripts/build-create-coin-tx.mjs` as `--metadata-uri`.
2. **Pinata (recommended):** Use the Pinata SDK to upload image and metadata JSON to IPFS — this is the same approach pump.fun's frontend uses. See the full guide below.
3. **Manual:** Host valid JSON at any HTTPS URL you control for testing (not recommended for production launches).

Never commit private keys or Pinata/JWT secrets into the skill repo or agent logs.

---

## Uploading metadata via Pinata (IPFS)

Pump.fun uses [Pinata](https://pinata.cloud) to pin coin images and metadata JSON to IPFS. You can replicate this flow with your own Pinata account.

### Prerequisites

```bash
npm install pinata
```

You need a **Pinata JWT** from your own Pinata account (free tier works). Set it as an environment variable — never hard-code it.

```env
PINATA_JWT=<your-pinata-jwt>
```

### Overview

The upload is a two-step process:

1. Upload the **coin image** to IPFS → receive an image CID.
2. Build the metadata JSON (with the image CID) and upload **that JSON** to IPFS → receive a metadata CID. The final `metadataUri` is `https://ipfs.io/ipfs/{metadataCid}`.

### Full example (Node.js)

```javascript
import { PinataSDK } from "pinata";
import fs from "fs";
import path from "path";

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
});

async function uploadCoinMetadata({
  imagePath,
  name,
  symbol,
  description,
  twitter,
  telegram,
  website,
}) {
  // --- Step 1: Create a presigned upload URL ---
  // Presigned URLs let you upload from a client without exposing the JWT.
  // In a server context you can also upload directly (see alternative below).
  const presignedUrl = await pinata.upload.public.createSignedURL({
    expires: 60,
    mimeTypes: ["image/*", "application/json"],
    maxFileSize: 5_000_000, // 5 MB
  });

  // --- Step 2: Upload the image ---
  const imageFile = new File(
    [fs.readFileSync(imagePath)],
    path.basename(imagePath),
    { type: "image/png" }, // adjust mime type as needed
  );
  const imageUpload = await pinata.upload.public.file(imageFile).url(presignedUrl);
  const imageCid = imageUpload.cid;
  const imageUri = `https://ipfs.io/ipfs/${imageCid}`;

  // --- Step 3: Build the metadata JSON ---
  const metadata = {
    name,
    symbol,
    description,
    image: imageUri,
    showName: true,
    createdOn: "https://pump.fun",
    ...(twitter && { twitter }),
    ...(telegram && { telegram }),
    ...(website && { website }),
  };

  // --- Step 4: Upload metadata JSON to IPFS ---
  // Need a fresh presigned URL for the second upload.
  const jsonPresignedUrl = await pinata.upload.public.createSignedURL({
    expires: 60,
    mimeTypes: ["application/json"],
    maxFileSize: 5_000_000,
  });
  const metadataUpload = await pinata.upload.public.json(metadata).url(jsonPresignedUrl);
  const metadataUri = `https://ipfs.io/ipfs/${metadataUpload.cid}`;

  console.log("Image URI:", imageUri);
  console.log("Metadata URI:", metadataUri);
  return { metadata, metadataUri };
}
```

### Alternative: direct upload (no presigned URL)

If you are running server-side and don't need presigned URLs, you can upload directly:

```javascript
const imageUpload = await pinata.upload.public.file(imageFile);
const metadataUpload = await pinata.upload.public.json(metadata);
```

### Using the result

Pass the `metadataUri` to the create scripts:

```bash
node scripts/build-create-coin-tx.mjs \
  --user <PUBKEY> \
  --name "My Coin" \
  --symbol "MYC" \
  --metadata-uri "https://ipfs.io/ipfs/<metadata-cid>" \
  --sol-lamports 1000000
```

### Important notes

- Each presigned URL is **single-use** and expires after the configured TTL (60 seconds recommended). Generate a fresh one for each upload.
- The `PINATA_JWT` is a secret. Keep it server-side. In a web app, create a backend endpoint that issues presigned URLs to the client — never send the JWT to the browser.
- Free Pinata accounts have upload limits. Check [pinata.cloud/pricing](https://pinata.cloud/pricing) for current quotas.
