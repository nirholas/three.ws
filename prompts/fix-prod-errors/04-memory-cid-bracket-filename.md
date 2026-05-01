# Fix: `[cid].js` bracket filename causes Vercel bundler to miss the file

## What is broken

`GET /api/agents/:id/memory/:cid` returns 500 in production:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/var/task/api/agents/_id/memory/[cid].js'
```

The helper file is named `[cid].js` — brackets in filenames are treated as route
parameter placeholders by Vercel's nft file tracer. Even though this file sits inside
a non-bracket directory (`_id/memory/`), the bracketed filename is still silently
dropped from the deployment bundle.

Note: `GET /api/agents/:id/memory/pin` may work fine (its file `pin.js` has no
brackets) — the only broken sub-route is `GET /api/agents/:id/memory/:cid`.

## Root cause

File tree:

```
api/agents/_id/memory/
  [cid].js      ← brackets in filename → not bundled by Vercel
  pin.js        ← fine
```

Import in `api/agents/[id].js` (~line 91):

```js
const mod = await import('./_id/memory/[cid].js');
```

The `[cid]` portion is literal in the import string. Vercel's nft tracer can't resolve
it and drops the file.

## Fix

### Step 1 — rename the file

```bash
mv "api/agents/_id/memory/[cid].js" "api/agents/_id/memory/_cid.js"
```

Or if the `[id]→_id` directory rename hasn't happened yet:

```bash
mv "api/agents/[id]/memory/[cid].js" "api/agents/[id]/memory/_cid.js"
```

The file content does not change at all — only the filename changes.

### Step 2 — update the import in `api/agents/[id].js`

Find the import on the `memory/:cid` branch (around line 91):

```js
// Before
const mod = await import('./_id/memory/[cid].js');

// After
const mod = await import('./_id/memory/_cid.js');
```

(If the `[id]→_id` rename hasn't been done yet, it will be `./[id]/memory/_cid.js`
instead — adjust accordingly.)

### Step 3 — verify no other references remain

```bash
grep -r "\[cid\]" api/
```

Should return nothing after the rename. The only places `[cid]` appeared were the
file itself and its single import site.

## Verify

1. `api/agents/_id/memory/[cid].js` no longer exists.
2. `api/agents/_id/memory/_cid.js` exists with the same content.
3. `grep "_cid.js" api/agents/[id].js` returns one line.
4. After deploying, `GET /api/agents/:id/memory/:cid` with a valid CID and auth returns
   the raw bytes (200 with `Content-Type: application/octet-stream`), not a 500.
5. `GET /api/agents/:id/memory/pin` still works (it was not broken — confirm no
   regression).

## Constraints

- Do not change any logic inside `_cid.js` — it is a pure rename.
- Do not change the IPFS gateway list or fetch logic.
- Do not change the response format: raw bytes with `Content-Type: application/octet-stream`.
- The file fetches real bytes from public IPFS gateways (dweb.link, cloudflare-ipfs,
  ipfs.io). Do not mock or stub the IPFS fetch.
