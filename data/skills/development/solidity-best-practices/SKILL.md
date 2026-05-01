---
name: solidity-best-practices
description: Guide for writing secure, gas-efficient, and maintainable Solidity smart contracts following established patterns and avoiding common pitfalls.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: sperax-team
  tags: [development, solidity, smart-contracts, best-practices, ethereum]
---

# Solidity Best Practices

## When to use this skill

Use when the user asks about:
- Writing or reviewing Solidity code
- Smart contract design patterns
- Gas optimization techniques in Solidity
- Security best practices for contract development
- Structuring a Solidity project

## Development Guidelines

### 1. Project Structure

Recommended contract organization:
- `contracts/` — main contract source files
- `contracts/interfaces/` — interface definitions (IProtocol.sol)
- `contracts/libraries/` — shared library code
- `contracts/utils/` — utility contracts (access control, pausable, etc.)
- `test/` — test files mirroring the contracts directory structure
- `script/` — deployment and interaction scripts

### 2. Coding Standards

Follow these Solidity style conventions:
- Use Solidity 0.8.x or later (built-in overflow checks)
- Specify exact compiler version with `pragma solidity 0.8.24;` (not floating `^`)
- Order contract elements: state variables, events, errors, modifiers, constructor, external, public, internal, private functions
- Use custom errors instead of `require` strings (saves gas): `error InsufficientBalance(uint256 available, uint256 required);`
- Use `immutable` for variables set once in the constructor
- Use `constant` for compile-time known values
- Prefix internal/private functions with underscore: `_validateInput()`
- Use NatSpec comments for all public/external functions

### 3. Gas Optimization Patterns

High-impact optimizations:
- **Storage packing**: Group variables smaller than 32 bytes together in a single storage slot (e.g., `uint128 a; uint128 b;` uses one slot vs two for `uint256`)
- **Calldata over memory**: Use `calldata` for external function array/struct parameters that are read-only
- **Caching storage reads**: Read a storage variable into a local variable if accessed multiple times in a function
- **Short-circuit conditions**: Place cheap checks before expensive ones in `require` chains
- **Unchecked math**: Use `unchecked {}` for arithmetic that provably cannot overflow (e.g., loop counters)
- **Avoid zero-to-nonzero writes**: Initializing a storage slot from 0 costs 20,000 gas vs 5,000 for nonzero-to-nonzero
- **Use mappings over arrays** when you don't need iteration — mappings have O(1) access
- **Batch operations**: Combine multiple operations into single transactions where possible

### 4. Security Patterns

Essential security practices:
- **Checks-Effects-Interactions (CEI)**: Validate inputs, update state, then make external calls — prevents reentrancy
- **Reentrancy guard**: Use OpenZeppelin's `ReentrancyGuard` for functions making external calls with value
- **Access control**: Use role-based access (OpenZeppelin `AccessControl`) rather than single-owner patterns
- **Pull over push**: Let users withdraw funds rather than pushing payments — avoids DoS via revert
- **Timelocks**: Add delay to sensitive admin operations so users can react
- **Input validation**: Validate all external inputs — check for zero addresses, bounds, array lengths
- **Safe token transfers**: Use OpenZeppelin's `SafeERC20` for token interactions
- **Event emission**: Emit events for all state changes — essential for off-chain monitoring

### 5. Upgrade Patterns

When contracts need to be upgradeable:
- Prefer UUPS over Transparent Proxy (lower gas for users)
- Always initialize via `initialize()` function (not constructor) with `initializer` modifier
- Reserve storage gaps: `uint256[50] private __gap;` in base contracts
- Never change storage variable order or types in upgrades
- Disable initializers on implementation: add `_disableInitializers()` in constructor
- Test upgrade compatibility before deploying

### 6. Testing Requirements

Every contract should have:
- Unit tests for each function covering happy path and revert cases
- Integration tests for multi-contract interactions
- Fuzz tests for functions with numerical inputs (Foundry's `forge test`)
- Invariant tests for protocol-wide properties that must always hold
- Fork tests against mainnet state for DeFi integrations
- Gas snapshots to track gas regression across changes

### 7. Deployment Checklist

Before deploying to mainnet:
- [ ] All tests passing with 100% line coverage on critical paths
- [ ] Static analysis run (Slither, Aderyn) with no high/critical findings
- [ ] Formal verification on core invariants if applicable
- [ ] Professional audit completed for high-value contracts
- [ ] Deployment script tested on testnet fork
- [ ] Constructor/initializer arguments double-checked
- [ ] Verify source code on block explorer immediately after deployment
- [ ] Admin roles transferred to multisig/governance
- [ ] Emergency pause mechanism tested
