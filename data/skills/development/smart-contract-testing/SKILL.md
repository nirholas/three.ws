---
name: smart-contract-testing
description: Guide for testing smart contracts using Foundry and Hardhat, covering unit tests, fuzz testing, invariant testing, fork testing, and gas benchmarking.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: sperax-team
  tags: [development, testing, foundry, hardhat, smart-contracts]
---

# Smart Contract Testing

## When to use this skill

Use when the user asks about:
- Writing tests for smart contracts
- Setting up a testing framework (Foundry or Hardhat)
- Fuzz testing or invariant testing strategies
- Fork testing against mainnet state
- Gas benchmarking and optimization verification
- Debugging failing contract tests

## Testing Framework Selection

### Foundry vs Hardhat

| Feature | Foundry | Hardhat |
|---------|---------|---------|
| Language | Solidity | JavaScript/TypeScript |
| Speed | Very fast (native) | Slower (JS runtime) |
| Fuzzing | Built-in | Requires plugins |
| Fork testing | Built-in | Built-in |
| Debugging | forge debug, traces | console.sol, traces |
| Ecosystem | Growing rapidly | Mature, large plugin ecosystem |

Recommendation: Use Foundry for new projects. Use Hardhat when you need complex JS scripting or specific Hardhat plugins.

## Testing with Foundry

### 1. Unit Test Structure

Follow this pattern for each test:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MyContract} from "../src/MyContract.sol";

contract MyContractTest is Test {
    MyContract internal target;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        target = new MyContract();
        deal(alice, 100 ether);
    }

    function test_deposit_succeeds() public {
        vm.prank(alice);
        target.deposit{value: 1 ether}();
        assertEq(target.balanceOf(alice), 1 ether);
    }

    function test_deposit_revertsWhenZero() public {
        vm.prank(alice);
        vm.expectRevert(MyContract.ZeroAmount.selector);
        target.deposit{value: 0}();
    }
}
```

Naming conventions:
- `test_functionName_scenario` for expected-pass tests
- `test_functionName_revertsWhen_condition` for expected-revert tests
- `testFuzz_functionName` for fuzz tests

### 2. Fuzz Testing

Let Foundry generate random inputs to find edge cases:

```solidity
function testFuzz_deposit(uint256 amount) public {
    // Bound the input to realistic ranges
    amount = bound(amount, 1, 100 ether);
    
    deal(alice, amount);
    vm.prank(alice);
    target.deposit{value: amount}();
    
    assertEq(target.balanceOf(alice), amount);
}
```

Best practices for fuzz tests:
- Use `bound()` to constrain inputs to valid ranges
- Use `vm.assume()` sparingly — prefer `bound()` to avoid too many rejected runs
- Set meaningful fuzz runs in `foundry.toml`: `[fuzz] runs = 1000`
- Focus fuzz testing on functions with numerical inputs and complex math

### 3. Invariant Testing

Define properties that must always hold regardless of actions:

```solidity
contract MyContractInvariant is Test {
    MyContract internal target;
    Handler internal handler;

    function setUp() public {
        target = new MyContract();
        handler = new Handler(target);
        targetContract(address(handler));
    }

    function invariant_totalSupplyMatchesBalances() public view {
        assertEq(
            target.totalSupply(),
            target.balanceOf(address(handler))
        );
    }
}
```

Common invariants to test:
- Total supply equals sum of all balances
- Contract balance always covers total deposits
- Exchange rates are monotonically non-decreasing
- Access control roles cannot be self-granted

### 4. Fork Testing

Test against real mainnet state:

```solidity
function test_swapOnUniswap_fork() public {
    // Fork mainnet at a specific block
    vm.createSelectFork("mainnet", 19_000_000);
    
    address usdc = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address weth = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    
    deal(usdc, alice, 10_000e6);
    
    vm.startPrank(alice);
    // ... execute swap logic
    vm.stopPrank();
    
    assertGt(IERC20(weth).balanceOf(alice), 0);
}
```

Fork testing tips:
- Pin to a specific block number for reproducibility
- Use `deal()` to set up token balances without needing to acquire them
- Test against multiple chains by configuring RPC URLs in `foundry.toml`
- Be mindful of rate limits on RPC providers

### 5. Gas Benchmarking

Track gas usage to catch regressions:

```bash
# Generate gas snapshot
forge snapshot

# Compare against previous snapshot
forge snapshot --check
```

In tests, measure specific operations:
```solidity
function test_deposit_gasUsage() public {
    vm.prank(alice);
    uint256 gasBefore = gasleft();
    target.deposit{value: 1 ether}();
    uint256 gasUsed = gasBefore - gasleft();
    
    // Assert gas is within expected range
    assertLt(gasUsed, 50_000, "deposit uses too much gas");
}
```

### 6. Coverage and CI

Ensure comprehensive test coverage:
- Run `forge coverage` to identify uncovered code paths
- Target 100% line coverage on security-critical functions
- Set up CI to run tests on every PR
- Include gas snapshot comparison in CI to catch regressions
- Run fuzz tests with higher iterations in CI (10,000+) vs local development (256)

### 7. Debugging Techniques

When tests fail:
- Use `forge test -vvvv` for full execution traces
- Add `console.log()` via `import "forge-std/console.sol";`
- Use `forge debug` for step-by-step EVM execution
- Check event emissions with `vm.expectEmit()`
- Verify storage values with `vm.load(address, slot)`
