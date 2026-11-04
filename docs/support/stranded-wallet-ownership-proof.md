# Wallet recovery: ownership-proof request

A support runbook for verifying that a claimant controls a wallet-auth account
before any stranded agent-wallet balance is released. Ownership is proven by
signature, never by narrative, and the payout only ever goes to a wallet the
claimant signs from, so there is no address for a bad actor to redirect funds to.

Every step runs through one tool, [`scripts/verify-wallet-ownership.mjs`](../../scripts/verify-wallet-ownership.mjs)
(`npm run verify:wallet-ownership -- <subcommand>`). It builds the challenge, keeps
the claim record, verifies both signatures with ed25519, and enforces expiry and
single use, so nothing in this flow is checked by hand.

## How to run a claim

### 1. Open the claim

```bash
npm run verify:wallet-ownership -- challenge --agent <agent uuid>
```

This prints a fresh single-use nonce and the exact text block to send, and writes
the claim record to `.support-claims/<agent>-<nonce>.json`. That directory is
git-ignored: claim records name a real customer's wallets and must never be
committed. Keep the record on the operator machine until the case closes.

The printed block always has this shape (four lines, newline separated, no
trailing newline; the tool fills in the real values):

```
three.ws wallet recovery
agent: <the agent uuid you passed>
nonce: <12 base64url characters, new for every claim>
issued: <the UTC time the claim was opened, to the second>
```

Never type this block yourself and never reuse one from an earlier case. The
signature covers these exact bytes, and a nonce is good for one claim only.

### 2. Send the request

Paste the block from step 1 into the customer message below, along with the
login wallet and funding wallet you expect for this account (read them from the
agent's account and its custody trail; see `docs/ops/stranded-wallets.md`).
Require signatures from BOTH wallets. The claimant has **72 hours** from the
`issued` time; after that the tool refuses the claim and you open a new one.

### 3. Verify the reply

```bash
npm run verify:wallet-ownership -- verify \
  --claim .support-claims/<agent>-<nonce>.json \
  --login-wallet <address> --login-sig <signature> \
  --funding-wallet <address> --funding-sig <signature> \
  --check-account
```

Signatures may be base58 (what Phantom and most Solana wallets show) or base64.
The tool prints `PASS` or `FAIL` with a reason for each wallet and exits 0 only
when both pass. It refuses:

- either signature failing (`signature_invalid`, `bad_signature_encoding`, `bad_address`),
- a claim older than 72 hours, or one issued in the future,
- a claim already `verified` or `used`, so a signature cannot be replayed,
- the same wallet as both login and funding wallet, unless you pass
  `--allow-same-wallet "<reason>"`; the reason is stored in the claim record.

`--check-account` (needs `DATABASE_URL`, read-only, never writes) confirms the
login wallet is a wallet recorded for the agent owner's account and lists every
destination in the agent's `agent_custody_events`, flagging any address that
shares the first and last four characters with the login or funding wallet but
differs. That pattern is address poisoning: an attacker sends dust from a
look-alike address hoping the victim copies it. Without a database the tool says
the check was skipped and why; run it from a machine that has the production
connection string before paying out.

### 4. Pay out and close

On `PASS` the tool prints the **only permitted payout destination: the login
wallet**. Send the balance there, never to an address the claimant types into a
message, then close the claim with the transaction signature:

```bash
npm run verify:wallet-ownership -- mark-used \
  --claim .support-claims/<agent>-<nonce>.json --tx <payout signature>
```

A `FAIL` ends the claim. Tell the claimant which wallet failed and that a new
request is required; open it with step 1.

---

## Message to the customer

Subject: Verifying your three.ws wallet before we release your balance

Hi,

We can help with your withdrawal. Because this balance is tied to a self-custody
wallet, we verify ownership cryptographically before releasing anything. This
protects you: it guarantees the funds can only ever go back to a wallet you
control, and no one else can claim them.

Please do the following. It takes about a minute and costs nothing (no gas, no
transaction, just a message signature). This request expires 72 hours after the
time shown in the text below.

**Sign this exact text, once from each of the two wallets below:**

```
(paste the four-line block from step 1 here, unchanged)
```

1. **Your login wallet** `(login wallet address)`
   (the wallet you use to sign in to three.ws).
2. **The wallet that originally funded the balance** `(funding wallet address)`.

How to sign in Phantom: open the wallet, go to Settings, choose "Sign Message"
(or use any wallet tool that signs an arbitrary message), paste the text above
exactly, and sign. Do not send any transaction. Then send us back, for each
wallet: the wallet address and the resulting signature string.

Once both signatures check out, we will send your balance to your login wallet
`(login wallet address)`. We can only pay out to a wallet you have proven you
control, so please make sure you can sign from it.

If you are unable to sign from either wallet, we unfortunately cannot verify the
claim and cannot release the balance.

Thanks,
three.ws support

---

## Notes for the operator (do not send)

- The signature is over the literal text block, newlines included and with no
  trailing newline. The tool verifies against the bytes stored in the claim
  record, so the block you sent and the block it checks are always the same.
- Both signatures are required. The login wallet proves account control; the
  funding wallet proves they are the party who deposited the money. A genuine
  owner controls both; an opportunist controls neither.
- The nonce and issued time make each request single-use and time-boxed, so an
  old or screenshotted signature cannot be replayed.
- The payout destination is fixed to the proven login wallet. Never send to an
  address the claimant simply types into a message.
- Read the `--check-account` output before paying. A flagged look-alike in the
  custody trail is expected on poisoned accounts; what matters is that the
  wallets that signed are the genuine ones, not the look-alikes.
- Tests: `npx vitest run tests/wallet-ownership.test.js tests/wallet-ownership-cli.test.js`.
