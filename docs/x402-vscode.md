# x402 for VS Code

The three.ws x402 extension lets you find, inspect, and pay paid APIs from VS
Code. It supports **$THREE or USDC on Solana**, plus **USDC on Base** and other
EVM chains. Wallet keys stay in VS Code SecretStorage, backed by your operating
system keychain.

- [Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=threews.vscode-x402)
- [View source and releases](https://github.com/nirholas/vscode-x402)
- [Browse the three.ws x402 Bazaar](/bazaar)

## Pay with $THREE

The extension can settle an x402 `exact` payment with the three.ws ecosystem
token when a service advertises it in its 402 challenge.

| Field | Value |
|---|---|
| Symbol | `$THREE` |
| Network | Solana |
| Contract address | `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump` |
| Preference setting | `x402.preferToken: "three"` |
| Payment scheme | `@x402/svm` exact |

The mint must match the contract address above. The extension shows the amount
in $THREE, the network, paying wallet, and recipient before signing. It always
requires explicit confirmation for $THREE because an x402 challenge does not
include a trusted fiat conversion.

## Install

Install from the Marketplace:

```bash
code --install-extension threews.vscode-x402
```

If the Marketplace still shows a version earlier than 0.2.0, install the newest
VSIX from [GitHub Releases](https://github.com/nirholas/vscode-x402/releases)
to get Solana and $THREE support.

## Configure Solana

1. Open VS Code and run **x402: Set Solana Wallet Key** from the command palette.
2. Enter a funded Solana secret key as base58 or a JSON byte array.
3. Open Settings and set `x402.bazaarUrl` to `https://three.ws`.
4. Set `x402.preferToken` to `three`.
5. Open the **x402 Bazaar** activity bar view, inspect a service, and select
   **Pay & call**.

A complete settings block looks like this:

```json
{
  "x402.bazaarUrl": "https://three.ws",
  "x402.network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "x402.preferToken": "three",
  "x402.maxPaymentUsd": 0.1,
  "x402.confirmEachPayment": true
}
```

The extension only pays with $THREE when the endpoint offers the exact $THREE
mint. If it does not, the endpoint remains visible and its other accepted
payment options are shown.

## Inspect before paying

The extension separates free inspection from payment:

1. It requests the endpoint and decodes the `402 Payment Required` response.
2. It lists each accepted network, token, amount, scheme, and recipient.
3. It selects a requirement your configured wallet can satisfy.
4. It asks for confirmation.
5. It signs the payment proof, retries the request once, and renders the response
   with the settlement transaction hash.

Browsing the Bazaar and inspecting challenges do not spend funds. A payment is
signed only after the confirmation step.

## Supported rails

| Rail | Tokens | Wallet command |
|---|---|---|
| Solana | $THREE and USDC | **x402: Set Solana Wallet Key** |
| EVM | USDC | **x402: Set EVM Wallet Key** |

When an endpoint accepts several options, `x402.network` and
`x402.preferToken` determine which eligible requirement wins. The default
selection prefers Solana USDC, then Base. Set `x402.preferToken` to `three`
to put $THREE first.

## Security

- Solana and EVM private keys are stored separately in VS Code SecretStorage.
- Private keys are never written to workspace settings.
- $THREE payments always require explicit confirmation.
- USDC payments above `x402.maxPaymentUsd` are blocked before signing.
- An endpoint that cannot be paid by a configured wallet is clearly marked.

## Related

- [x402 protocol on three.ws](x402.md)
- [x402 paid endpoints](x402-endpoints.md)
- [x402 buyer client](x402-buyer.md)
- [three.ws in VS Code](vscode.md)
