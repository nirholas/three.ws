---
name: smart-contract-auditing
description: Complete mastery guide for smart contract security auditing — from first principles of EVM bytecode to advanced exploit patterns. Covers manual code review methodology, automated tooling (Slither, Mythril, Foundry fuzz), common vulnerability taxonomy (reentrancy, flash-loan attacks, oracle manipulation, access control, integer math), audit report writing, severity classification (Critical/High/Medium/Low/Informational), gas optimization reviews, upgrade safety, and DeFi-specific audit checklists for lending, AMM, vault, and stablecoin protocols.
license: MIT
metadata:
  category: security
  difficulty: advanced
  author: nich
  tags: [security, smart-contract-auditing, solidity, audit, exploit, reentrancy, flash-loan, oracle-manipulation]
---

# Smart Contract Auditing — From Zero to Expert

This skill teaches you to think like a top-tier smart contract auditor. You'll learn to find vulnerabilities that automated tools miss, write clear findings, and reason about protocol-level risks in DeFi systems.

## The Auditor's Mindset

> "Your job is not to confirm the code works. It's to prove it can break."

An auditor must think adversarially. Every function is a potential attack surface. Every external call is a trust boundary. Every assumption is a vulnerability waiting to happen.

```
┌─────────────────────────────────────────────────┐
│              AUDITOR'S MENTAL MODEL              │
├─────────────────────────────────────────────────┤
│                                                  │
│   1. UNDERSTAND the protocol's invariants        │
│   2. ENUMERATE every state-changing path         │
│   3. CHALLENGE every assumption                  │
│   4. SIMULATE adversarial scenarios              │
│   5. VERIFY mitigations are complete             │
│                                                  │
│   "What must ALWAYS be true?" ← start here       │
│   "How can I make it false?" ← then ask this     │
│                                                  │
└─────────────────────────────────────────────────┘
```

## Vulnerability Taxonomy

### Tier 1 — Critical (Funds at Risk)

| Vulnerability | What Breaks | Classic Example |
|--------------|-------------|-----------------|
| **Reentrancy** | State updated after external call | The DAO hack ($60M) |
| **Flash Loan Attack** | Price oracle manipulation in single tx | bZx ($8M), Cream ($130M) |
| **Access Control** | Missing `onlyOwner` / role checks | Parity wallet freeze ($280M) |
| **Unchecked Return Values** | Silent failure on transfer | Token transfers returning false |
| **Storage Collision** | Proxy upgrades overwriting slots | Audius governance ($6M) |

### Tier 2 — High (Protocol Malfunction)

| Vulnerability | What Breaks | How to Spot |
|--------------|-------------|-------------|
| **Oracle Manipulation** | Price feeds return stale/wrong data | Check `updatedAt` staleness |
| **Integer Overflow/Underflow** | Math wraps around (pre-0.8.0) | Solidity < 0.8 without SafeMath |
| **Front-running** | MEV bots sandwich user txs | Unprotected swaps, auctions |
| **Denial of Service** | Unbounded loops, gas griefing | Arrays that grow without limit |
| **Signature Replay** | Same sig reused across chains/contracts | Missing nonce or chainId |

### Tier 3 — Medium (Edge Cases)

| Vulnerability | What Breaks | How to Spot |
|--------------|-------------|-------------|
| **Rounding Errors** | Dust accumulation, unfair distributions | Division before multiplication |
| **Timestamp Dependence** | Miners manipulate block.timestamp | ±15 second tolerance |
| **Centralization Risk** | Admin can rug (even if "trusted") | Unrevoked roles, no timelock |
| **Missing Events** | Off-chain trackers lose sync | State changes without `emit` |
| **Gas Optimization** | Tx reverts on large sets | Storage reads in loops |

## The Audit Process

### Phase 1: Scoping (Day 1)

```
Questions to answer before reading ANY code:
─────────────────────────────────────────────
□ What does this protocol DO? (lending, DEX, vault, stablecoin?)
□ What are the protocol invariants?
   - "Total deposits ≥ total borrows"
   - "LP token supply × price ≥ pool reserves"
   - "Collateral ratio always > liquidation threshold"
□ What's the attack surface?
   - External entry points (public/external functions)
   - Admin/privileged functions
   - Oracle dependencies
   - Cross-contract interactions
□ What token standards are involved? (ERC-20, ERC-721, ERC-4626, rebasing?)
□ Is it upgradeable? (proxy pattern? UUPS? Transparent?)
□ What chains is it deployed on? (different precompiles, EIPs)
```

### Phase 2: Architecture Review (Day 1-2)

Draw the contract dependency graph:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Router     │────▶│    Vault      │────▶│   Strategy   │
│ (user entry) │     │ (holds funds) │     │ (deploys $)  │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │  PriceOracle  │
                     │ (Chainlink)   │
                     └──────────────┘
```

Identify trust boundaries:
- **User → Router**: Input validation, slippage checks
- **Router → Vault**: Authorization, reentrancy guards
- **Vault → Strategy**: Withdrawal limits, accounting
- **Vault → Oracle**: Staleness checks, deviation bounds

### Phase 3: Line-by-Line Review (Day 2-5)

#### Checklist Per Function

```solidity
// For EVERY external/public function, verify:

// 1. ACCESS CONTROL
// ✓ Who can call this? Is that correct?
// ✓ Are modifiers applied? (onlyOwner, onlyRole, whenNotPaused)

// 2. INPUT VALIDATION
// ✓ Are all parameters validated? (address != 0, amount > 0)
// ✓ Are array lengths bounded?
// ✓ Can attacker pass malicious calldata?

// 3. STATE CHANGES
// ✓ Is state updated BEFORE external calls? (CEI pattern)
// ✓ Are all related state variables updated atomically?
// ✓ Can this function be called recursively? (reentrancy)

// 4. EXTERNAL CALLS
// ✓ Is the target trusted? What if it's a malicious contract?
// ✓ Are return values checked?
// ✓ Is the call wrapped in try/catch where needed?

// 5. MATH
// ✓ Division before multiplication? (precision loss)
// ✓ Can values overflow? (unlikely in 0.8+ but check casts)
// ✓ Zero denominators? (division by zero)
// ✓ Rounding direction — who benefits? (always round against user)

// 6. TOKEN HANDLING
// ✓ Fee-on-transfer tokens? (actual received != amount sent)
// ✓ Rebasing tokens? (balance changes between snapshots)
// ✓ ERC-777 hooks? (potential reentrancy via tokensReceived)
// ✓ Return value check? (some tokens don't return bool)

// 7. EVENTS
// ✓ Is every state change emitted?
// ✓ Are indexed fields correct for off-chain filtering?
```

### Phase 4: Attack Simulation (Day 3-5)

Write proof-of-concept exploits in Foundry:

```solidity
// test/audit/ReentrancyPoC.t.sol
contract ReentrancyAttack is Test {
    Vault vault;
    AttackerContract attacker;

    function setUp() public {
        vault = new Vault();
        attacker = new AttackerContract(address(vault));
        // Fund vault with 100 ETH
        deal(address(vault), 100 ether);
        // Attacker deposits 1 ETH
        deal(address(attacker), 1 ether);
        attacker.deposit{value: 1 ether}();
    }

    function testReentrancyDrain() public {
        uint256 vaultBefore = address(vault).balance;
        attacker.attack();
        uint256 vaultAfter = address(vault).balance;
        // If vault is drained, reentrancy exists
        assertLt(vaultAfter, vaultBefore / 2, "Vault should be drained");
    }
}
```

#### Fuzz Testing for Edge Cases

```solidity
function testFuzz_withdrawNeverExceedsBalance(
    uint256 depositAmount,
    uint256 withdrawAmount
) public {
    depositAmount = bound(depositAmount, 1, 1e30);
    withdrawAmount = bound(withdrawAmount, 0, depositAmount);

    vault.deposit(depositAmount);
    vault.withdraw(withdrawAmount);

    assertGe(
        vault.balanceOf(address(this)),
        depositAmount - withdrawAmount,
        "Balance invariant violated"
    );
}
```

## Automated Tooling

Use tools to AUGMENT manual review, never replace it.

| Tool | Best For | Catches | Misses |
|------|----------|---------|--------|
| **Slither** | Static analysis | Common patterns, reentrancy, uninitialized vars | Business logic |
| **Mythril** | Symbolic execution | Integer overflow, assert violations | Complex DeFi logic |
| **Echidna** | Property-based fuzzing | Invariant violations | Requires good properties |
| **Foundry Fuzz** | Targeted fuzzing | Edge cases in math | Requires test writing |
| **4naly3er** | Gas + info findings | Optimization, best practices | No security findings |
| **Aderyn** | Rust-based static analysis | Fast pattern matching | Limited rule set |

### Running an Automated Pass

```bash
# Static analysis
slither . --print human-summary
slither . --detect reentrancy-eth,reentrancy-no-eth,unchecked-transfer

# Symbolic execution
myth analyze contracts/Vault.sol --solv 0.8.20 --execution-timeout 300

# Property-based fuzzing
echidna . --contract VaultTest --test-mode assertion --test-limit 50000
```

## DeFi-Specific Audit Checklists

### Lending Protocol Checklist

```
□ Liquidation math is correct (health factor, close factor)
□ Bad debt is handled (socializing losses or insurance fund)
□ Interest rate model handles extreme utilization (100%)
□ Oracle manipulation can't create instant liquidatable positions
□ Flash loans can't manipulate collateral prices within one tx
□ Supply/borrow caps prevent single-asset concentration
□ Pause mechanism covers all entry points
□ Collateral factors account for token volatility
```

### AMM / DEX Checklist

```
□ Constant product invariant maintained (x * y = k)
□ Swap cannot drain pool to zero on either side
□ Slippage protection cannot be bypassed
□ LP share calculation is rounding-safe
□ Fee accounting doesn't leak value
□ Flash swaps repay within same tx (or revert)
□ Pool creation can't be front-run with bad initial ratio
□ Remove liquidity handles single-sided correctly
```

### Vault / Yield Checklist (ERC-4626)

```
□ Deposit/withdraw exchange rate can't be manipulated
□ "Donation attack" prevented (first depositor gets fair shares)
□ Strategy can't lose more than deposited (bounded loss)
□ Emergency withdrawal bypasses strategy locks
□ Harvest/compound doesn't benefit front-runners
□ Share price increases monotonically (no loss of precision)
□ Fee calculation rounds in protocol's favor
```

### Stablecoin Checklist (e.g., Sperax USDs)

```
□ Peg mechanism handles de-peg scenarios
□ Collateral ratio maintained above safety threshold
□ Rebasing doesn't break integrating contracts
□ Mint/redeem can't be sandwich attacked
□ Oracle failure triggers protective pause
□ Collateral diversification limits enforced
□ Emergency redemption path exists
□ Yield distribution is fair across all holders
```

## Writing Audit Reports

### Finding Format

```markdown
## [H-01] Reentrancy in Vault.withdraw() allows complete fund drainage

**Severity**: High
**Status**: Open
**Location**: Vault.sol#L142-L158

### Description
The `withdraw()` function sends ETH to the caller before updating
the `balances` mapping, allowing a malicious contract to re-enter
and withdraw repeatedly.

### Impact
An attacker can drain the entire vault balance in a single transaction.

### Proof of Concept
[Link to PoC test]

### Recommendation
Apply the Checks-Effects-Interactions pattern:
```

### Severity Classification

| Severity | Criteria | Example |
|----------|----------|---------|
| **Critical** | Direct loss of funds, no user interaction needed | Reentrancy drain, access control bypass |
| **High** | Loss of funds with some conditions | Oracle manipulation + flash loan |
| **Medium** | Funds not at immediate risk, protocol malfunction | DoS, griefing, incorrect accounting |
| **Low** | Best practice violations, minor issues | Missing events, suboptimal patterns |
| **Informational** | Suggestions, gas optimizations | Use `immutable`, cache storage reads |

## Common Patterns — What Good Code Looks Like

### Checks-Effects-Interactions (CEI)

```solidity
// ✅ CORRECT — state updated before external call
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount);  // Check
    balances[msg.sender] -= amount;            // Effect
    (bool ok,) = msg.sender.call{value: amount}(""); // Interaction
    require(ok);
}
```

### Pull Over Push

```solidity
// ✅ CORRECT — users withdraw, contract doesn't push
mapping(address => uint256) public pendingWithdrawals;

function claimReward() external {
    uint256 amount = pendingWithdrawals[msg.sender];
    pendingWithdrawals[msg.sender] = 0;
    token.safeTransfer(msg.sender, amount);
}
```

### Access Control with Timelock

```solidity
// ✅ CORRECT — admin actions have delay
function queueAction(bytes32 actionHash) external onlyAdmin {
    timelockExpiry[actionHash] = block.timestamp + 48 hours;
    emit ActionQueued(actionHash);
}

function executeAction(bytes32 actionHash) external onlyAdmin {
    require(block.timestamp >= timelockExpiry[actionHash], "Too early");
    delete timelockExpiry[actionHash];
    _execute(actionHash);
}
```

## Sperax Ecosystem Audit Considerations

When auditing protocols that integrate with Sperax:

- **USDs Rebasing**: USDs balances change every rebase. Contracts holding USDs must handle `balanceOf()` returning different values between blocks without any transfer occurring
- **SPA Staking**: veSPA lock periods create time-weighted voting power; verify governance contracts weight correctly
- **ERC-8004 Agents**: On-chain agent identity NFTs — verify agent metadata is immutable post-registration and reputation scores can't be manipulated
- **Farms Rewards**: Sperax Farms distribute rewards per-block; verify `rewardPerToken()` accumulator handles zero-supply edge case

## Resources for Continued Learning

| Resource | Type | Level |
|----------|------|-------|
| [Damn Vulnerable DeFi](https://www.damnvulnerabledefi.xyz/) | CTF challenges | Intermediate |
| [Ethernaut](https://ethernaut.openzeppelin.com/) | CTF challenges | Beginner |
| [Solidity by Example — Hacks](https://solidity-by-example.org/hacks/) | Code examples | Beginner |
| [Immunefi Bug Bounty](https://immunefi.com/) | Real bounties | Advanced |
| [Trail of Bits blog](https://blog.trailofbits.com/) | Research articles | Advanced |
| [Spearbit reports](https://github.com/spearbit/portfolio) | Real audit reports | Advanced |
