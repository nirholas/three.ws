// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {SkinHook} from "../src/SkinHook.sol";
import {HookMiner} from "../script/HookMiner.sol";

/// Proves the deploy path itself: a mined salt really lands the hook at an address whose
/// flags pass the hook's own constructor check, with no `deployCodeTo` shortcut.
contract HookMinerTest is Test {
    uint160 constant FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);

    function test_minedSaltDeploysAValidHook() public {
        PoolManager manager = new PoolManager(address(this));
        bytes memory initCode =
            abi.encodePacked(type(SkinHook).creationCode, abi.encode(manager, address(this), address(0xBEEF)));
        (address expected, bytes32 salt) = HookMiner.find(address(this), FLAGS, initCode);

        SkinHook hook = new SkinHook{salt: salt}(manager, address(this), address(0xBEEF));
        assertEq(address(hook), expected);
        assertEq(uint160(address(hook)) & ((1 << 14) - 1), FLAGS);
    }
}
