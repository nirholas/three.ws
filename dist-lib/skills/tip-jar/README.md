# Tip Jar Skill

Lets a viewer send a USDC tip directly to the agent's creator wallet via an
ERC-7710 scoped delegation — no intermediary custody, no wallet pop-up after the
initial grant.

## Scope requested

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| token       | USDC on the active chain (6 decimals)   |
| maxAmount   | 10 000 000 base units (10 USDC) per day |
| period      | daily                                   |
| targets     | USDC contract on the active chain       |
| expiry_days | 30                                      |

Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## Happy-path flow

```
Viewer clicks "Tip the creator"
      │
      ▼
Amount picker (1 / 5 / 10 USDC or custom ≤ 10)
      │ viewer selects amount
      ▼
buildERC20Transfer(usdcAddr, agent.ownerAddress, amountBaseUnits)
  → { to: usdcAddr, value: '0x0', data: 0xa9059cbb + paddedAddr + paddedAmt }
      │
      ▼
redeemFromSkill({ agentId, chainId, skillId: 'tip-jar', calls: [call] })
      │
      ▼
DelegationManager.redeemDelegations() on Base Sepolia (ERC-7710)
      │
      ▼
USDC transfer: viewer delegated wallet → agent.ownerAddress  ✓
      │
      ▼
host.speak("Thank you for the tip!")
protocol.emit({ type: 'tip.received', payload: { agentId, amountUsdc, txHash } })
```

## No-delegation path

```
redeemFromSkill → error: no_delegation
      │
      ├─ viewer is NOT owner → "The creator hasn't enabled tipping on this device yet."
      │
      └─ viewer IS owner     → attachAction("Grant tipping")
                                    │
                                    ▼
                              openGrantModal({ preset: { token, maxAmount: '10000000', ... } })
                                    │
                                    ▼
                              MetaMask ERC-7715 permission request
                                    │
                                    ▼
                              delegation stored → tip flow retried
```

## ERC-20 calldata format

```
selector : 0xa9059cbb  (keccak256("transfer(address,uint256)")[0:4])
arg[0]   : recipient address, zero-padded left to 32 bytes
arg[1]   : amount in base units, big-endian uint256 padded to 32 bytes

Example — 5 USDC to 0x1234...5678:
0xa9059cbb
0000000000000000000000001234567890123456789012345678901234567890
00000000000000000000000000000000000000000000000000000000004c4b40
```

## Files

| File            | Purpose                                    |
| --------------- | ------------------------------------------ |
| `SKILL.md`      | LLM instructions + scope declaration       |
| `manifest.json` | Skill metadata, sandboxPolicy, permissions |
| `skill.js`      | `setup` / `execute` exports + pure helpers |
| `skill.css`     | Tip-amount picker modal styles             |

## Dependencies (lazy-loaded at runtime)

- **task 13** — `src/runtime/delegation-redeem.js` → `redeemFromSkill`
- **task 10** — `src/permissions/grant-modal.js` → `openGrantModal`

If either module is absent the skill degrades gracefully: it loads without errors
and surfaces a human-readable message instead of crashing.

## Skill registry

No standalone registry file exists in this repo. To activate the tip-jar for an
agent, add an entry to that agent's `manifest.json` `skills` array:

```json
{ "uri": "/skills/tip-jar/", "version": "0.1.0" }
```
