# Fix: `onConfirmed` callback never fires

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## The Bug

`BrowserWalletClient` has an `onConfirmed` callback option that should fire after a transaction is confirmed on-chain with its signature. It never fires.

**Root cause — two-part:**

**Part 1** — `browser-server.ts` sign handler returns `{ ok: true }` with no signature:
```ts
// src/wallet/browser-server.ts ~line 190-193
if (req.method === "POST" && action === "sign" && id) {
  const body = (await req.json()) as { signedTransaction: string };
  this.submitSigned(id, body.signedTransaction);
  return Response.json({ ok: true });   // ← no signature here
}
```

**Part 2** — `browser-client.ts` expects `{ signature }` in that same response:
```ts
// src/wallet/browser-client.ts ~line 159-161
if (res.ok) {
  const { signature } = (await res.json()) as { signature?: string };
  if (signature) this.opts.onConfirmed?.(pending, signature);  // never true
}
```

The problem: `submitSigned` resolves the server-side Promise, which triggers `signAndSendTransaction` to broadcast the tx. But by then the HTTP response has already been sent with `{ ok: true }`. The browser never learns the final signature.

## Fix

The sign handler needs to:
1. Wait for the server to broadcast and confirm the transaction
2. Return `{ signature: string }` in the response

This requires the server to know when the tx has been confirmed. The cleanest approach is to make `submitSigned` return a Promise that resolves to the signature after the server-side flow completes.

**Changes needed:**

### `src/wallet/browser-server.ts`

Change `submitSigned` to return `Promise<string>` (the confirmed signature):
```ts
submitSigned(txId: string, signedBase64: string): Promise<string>
```

Add an internal emitter for the confirmed signature. After `signAndSendTransaction` completes on the server side, emit `confirmed:${id}` with the signature.

In `signAndSendTransaction`, after broadcasting and confirming, emit `confirmed:${id}`:
```ts
async signAndSendTransaction(...) {
  const signed = await this.signTransaction(tx);  // waits for browser
  const sig = await connection.sendRawTransaction(signed.serialize(), ...);
  await connection.confirmTransaction(sig, "confirmed");
  this.emitter.emit(`confirmed:${sig_from_signTransaction_id}`, sig);  // notify waiting sign handler
  return sig;
}
```

The tricky part: `signTransaction` creates the pending entry and returns the signed tx. Once it resolves, `signAndSendTransaction` has the sig. The sign HTTP handler needs to wait for that sig.

**Recommended implementation:**

In `browser-server.ts`, change the sign handler to wait for a `confirmed:${id}` event before responding:

```ts
// In createHandler():
if (req.method === "POST" && action === "sign" && id) {
  const body = (await req.json()) as { signedTransaction: string };
  
  // Create a Promise that resolves when the server broadcasts + confirms
  const sigPromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("confirmation timeout")), 60_000);
    this.emitter.once(`confirmed:${id}`, (sig: string) => {
      clearTimeout(timeout);
      resolve(sig);
    });
  });
  
  this.submitSigned(id, body.signedTransaction);  // triggers signAndSendTransaction
  
  try {
    const signature = await sigPromise;
    return Response.json({ ok: true, signature });
  } catch {
    return Response.json({ ok: false, error: "confirmation timeout" }, { status: 408 });
  }
}
```

In `signAndSendTransaction`, after confirming, emit `confirmed:${id}` where `id` is... 

Wait — the problem is that after `signTransaction` resolves, you have the signed tx but not the pending `id`. The `id` is internal to the pending entry.

**Better approach**: store a second emitter map from `id → confirmed`. Pass the `id` through the signing flow.

In `signTransaction`, after the Promise resolves (browser has signed), emit `confirmed:${id}` in the `signAndSendTransaction` wrapper.

Change `signAndSendTransaction` to:
```ts
async signAndSendTransaction(tx, connection) {
  // Need the pending id before signTransaction removes it from the map.
  // Reserve an id upfront, store it as nextPendingId, consume in signTransaction.
  const signed = await this.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), ...);
  await connection.confirmTransaction(sig, "confirmed");
  // Emit confirmed with the id that was used for this tx
  // signTransaction should expose which id was used
  return sig;
}
```

The cleanest fix: add a `lastSignedId` field that `signTransaction` sets before creating the pending entry, so `signAndSendTransaction` can emit the `confirmed:${id}` event with the right id.

Or even simpler: use a `Map<id, (sig: string) => void>` called `confirmListeners`. In the sign handler, register a listener keyed by `id`. After broadcasting, call it.

**Exact implementation to use:**

Add `private readonly confirmListeners = new Map<string, (sig: string) => void>();`

In `signTransaction`, before resolving the signed tx back to `signAndSendTransaction`, do NOT emit yet — just return the id alongside the signed tx (internal only).

Actually the simplest correct solution:

Modify `signTransaction` to internally track the `id` so `signAndSendTransaction` can emit after confirming. Use an instance variable `private lastPendingId: string | null = null` set at the start of `signTransaction` and cleared after use.

Then in `signAndSendTransaction`:
```ts
async signAndSendTransaction(tx, connection) {
  const signed = await this.signTransaction(tx);           // sets lastPendingId
  const pendingId = this.lastPendingId;                    // capture before clearing
  this.lastPendingId = null;
  const sig = await connection.sendRawTransaction(...);
  await connection.confirmTransaction(sig, "confirmed");
  if (pendingId) this.emitter.emit(`confirmed:${pendingId}`, sig);
  return sig;
}
```

In the sign handler, register a listener before calling `submitSigned`:
```ts
const sigPromise = new Promise<string | null>((resolve) => {
  const t = setTimeout(() => resolve(null), 60_000);
  this.emitter.once(`confirmed:${id}`, (sig: string) => {
    clearTimeout(t);
    resolve(sig);
  });
});
this.submitSigned(id, body.signedTransaction);
const signature = await sigPromise;
return Response.json(signature ? { ok: true, signature } : { ok: false });
```

### `src/wallet/browser-client.ts`

No changes needed — it already reads `{ signature }` from the response and calls `onConfirmed` if present. Once the server returns the real signature, the callback will fire correctly.

## Verification

1. `npm run build` passes with zero errors
2. The `onConfirmed` callback in `BrowserWalletClientOptions` is properly typed and reachable
3. `browser-server.ts` sign handler returns `{ ok: true, signature: string }` after confirmation
4. No regression in the `rejected` handler (still returns `{ ok: true }`)
