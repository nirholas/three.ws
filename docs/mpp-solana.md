# MPP on Solana

MPP (Machine Payments Protocol) is the HTTP 402 payment scheme built on `WWW-Authenticate: Payment`. three.ws speaks the Solana `charge` method alongside x402 on the same URL: one price, one payee, one settlement path, one receipt.

## What a buyer sees

An endpoint that opts in answers an unpaid request with a normal x402 `402` body and `PAYMENT-REQUIRED` header, plus:

```
www-authenticate: Payment id="...", realm="three.ws", method="solana", intent="charge", request="<base64url JSON>", expires="<ISO time>"
```

The decoded `request` is `{ amount, currency, recipient, methodDetails: { network, decimals, feePayer, feePayerKey } }`. The amount, mint and payee are exactly the x402 `exact` Solana accept entry. `expires` is five minutes out. The challenge `id` is an HMAC of its terms (secret: `MPP_SECRET_KEY`, falling back to `A2A_MANDATE_SECRET`), so nothing is stored: a credential that echoes a valid id proves we issued those exact terms.

## Paying

Pull mode. The payer builds the same partially signed SPL `TransferChecked` transaction an x402 `exact` payment carries (the sponsor fee-payer slot stays empty) and retries with:

```
Authorization: Payment <base64url {challenge, source, payload: {type: "transaction", transaction: <base64>}}>
```

On success the response carries `Payment-Receipt` (method `solana`, `reference` = settlement signature) next to the usual `x-payment-response`. Native SOL, split and confidential charges are declined by the buyer rather than mispaid.

The credential is lifted out of `Authorization` before access control runs, so it is never mistaken for a login, and it settles through the existing verify and settle path: the facilitator check, the replay guard, the per-route price and the receipt row are shared with x402.

## Selling

```js
export default paidEndpoint({
	route: '/api/x402/gas-oracle',
	networks: ['solana', 'base'],
	mpp: true,
	// ...
});
```

`mpp: true` needs a Solana network on the route. Paid skills enable it per skill through the `mpp` rail (see [one definition, many rails](./skill-rails.md)). Wire layer: [api/_lib/mpp-solana.js](../api/_lib/mpp-solana.js), built on the MIT `mppx` core.

## Agent payer

`buyerFetch` pays either protocol with one call:

```js
const quote = await buyerFetch(url, { dryRun: true, caps, signPayment }); // reads the offers, checks the cap, signs nothing
const paid = await buyerFetch(url, { preferProtocol: 'mpp', caps, signPayment });
```

An MPP charge is expressed as the equivalent `exact` requirement, so the spending caps (`maxPerCall`, hourly, daily), `signPayment` and the guard layers see one shape. `result.protocol` says which protocol paid, and `result.settled` is read from `Payment-Receipt`. The terminal payer (`three-ws pay`, see [cli](./cli.md)) redeems the same challenge.

## Verifying

`npx vitest run tests/mpp-solana.test.js` runs a real HTTP server around `paidEndpoint`, real transaction signing against a local JSON-RPC stub, the buyer caps, a forged and an expired credential, and the CLI payer's challenge parser and signer against the server.

Mainnet settlement of a real charge spends USDC and is owner-gated. After approval, point the CLI at a live MPP endpoint:

```
three-ws pay https://three.ws/api/x402/gas-oracle --max 0.002
```
