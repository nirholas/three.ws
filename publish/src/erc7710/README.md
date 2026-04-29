# src/erc7710 — ERC-7710 DelegationManager constants & pure encoders

## What this module is

Constants and pure ABI-encoding helpers for the MetaMask DelegationManager contract
(ERC-7710). It is the single source of truth for contract addresses and ABI fragments
used across the permissions subsystem.

All addresses are sourced from `@metamask/delegation-deployments` v1.2.0 (DEPLOYMENTS_1_3_0),
verified 2026-04-18. All supported chains share the same CREATE2 addresses.

## Exports

| Export                                          | Description                                                |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `DELEGATION_MANAGER_DEPLOYMENTS`                | `{ chainId: address }` map for DelegationManager           |
| `DELEGATION_MANAGER_ABI`                        | ethers v6 human-readable ABI strings                       |
| `CAVEAT_ENFORCERS`                              | `{ enforcerName: { chainId: address } }` map               |
| `EIP712_DOMAIN({ chainId, verifyingContract })` | Returns EIP-712 domain separator fields                    |
| `DELEGATION_TYPES`                              | EIP-712 `types` object for `Delegation` + `Caveat`         |
| `encodeCaveats(caveats)`                        | ABI-encodes `{ enforcer, terms, args }[]` for on-chain use |

## What is NOT in this module

- **No signing** — `signTypedData` and wallet interaction live in `src/permissions/toolkit.js`.
- **No RPC calls** — no `eth_call`, `eth_getCode`, or provider logic here.
- **No redemption logic** — `redeemDelegations` call construction is in `src/permissions/toolkit.js`.
- **No UI** — grant/manage modals are in `src/permissions/`.

## How `src/permissions/toolkit.js` consumes this module

```js
import {
	DELEGATION_MANAGER_DEPLOYMENTS,
	DELEGATION_MANAGER_ABI,
	EIP712_DOMAIN,
	DELEGATION_TYPES,
	encodeCaveats,
} from '../erc7710/abi.js';

// Get the DelegationManager address for the active chain
const managerAddress = DELEGATION_MANAGER_DEPLOYMENTS[chainId];

// Build an ethers Contract instance
const manager = new ethers.Contract(managerAddress, DELEGATION_MANAGER_ABI, signer);

// Sign a delegation
const domain = EIP712_DOMAIN({ chainId, verifyingContract: managerAddress });
const sig = await signer.signTypedData(domain, DELEGATION_TYPES, delegationObject);

// Encode caveats before constructing the delegation struct
const encodedCaveats = encodeCaveats([
	{ enforcer: CAVEAT_ENFORCERS.TimestampEnforcer[chainId], terms: '0x...', args: '0x' },
]);
```
