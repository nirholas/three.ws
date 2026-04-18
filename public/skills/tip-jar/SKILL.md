---
name: tip-jar
version: 0.1.0
description: Let viewers send a USDC tip directly to the agent creator.
trust: owned-only
permissions_required: true
cost: medium
triggers:
  - tip_request
  - viewer_appreciation
default_scope_preset: '{"token":"chain-specific-usdc","maxAmount":"10000000","period":"daily","targets":["usdc-contract"],"expiry_days":30}'
---

# Tip Jar

Allows viewers to send a USDC tip directly to the agent's creator wallet. No intermediary
holds the funds — the ERC-7710 delegation redeems a transfer straight from the viewer's
delegated allowance to `agent.ownerAddress`.

When a viewer expresses appreciation or asks how to support the creator, invoke
`tip_jar_send`. Tip options are 1, 5, or 10 USDC (up to the daily cap of 10 USDC).

On success, thank the viewer warmly.

## Scope requested

| Field       | Value                                           |
| ----------- | ----------------------------------------------- |
| token       | USDC on the active chain (6 decimals)           |
| maxAmount   | 10 000 000 base units (10 USDC) per day         |
| period      | daily                                           |
| targets     | USDC contract address on the active chain       |
| expiry_days | 30                                              |

## Error cases

- **no_delegation / delegation_not_found** — Creator hasn't granted tipping permissions.
  Tell the viewer: "The creator hasn't enabled tipping on this device yet."
  If the current viewer is the owner, surface a "Grant tipping" button.
- **scope_exceeded** — Daily cap reached. Tell the viewer to try again tomorrow.
- **delegation_expired / delegation_revoked** — Surface the error code to the viewer.
