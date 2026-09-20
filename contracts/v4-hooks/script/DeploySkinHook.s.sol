// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SkinHook} from "../src/SkinHook.sol";
import {HookMiner} from "./HookMiner.sol";

/// Deploys SkinHook through the canonical CREATE2 deployer at a mined, flag-matching address.
///
///   POOL_MANAGER=0x498581ff718922c3f8e6a244956af099b2652b2b \
///   HOOK_OWNER=0x... HOOK_TREASURY=0x... \
///   forge script script/DeploySkinHook.s.sol --rpc-url base --broadcast --verify
///
/// Without --broadcast it is a dry run that prints the address the hook would land at.
contract DeploySkinHook is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    // beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta | afterSwapReturnsDelta
    uint160 constant FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);

    function run() external returns (SkinHook hook) {
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address owner = vm.envAddress("HOOK_OWNER");
        address treasury = vm.envAddress("HOOK_TREASURY");

        bytes memory initCode = abi.encodePacked(type(SkinHook).creationCode, abi.encode(poolManager, owner, treasury));
        (address expected, bytes32 salt) = HookMiner.find(CREATE2_DEPLOYER, FLAGS, initCode);
        console2.log("SkinHook will deploy at", expected);
        console2.logBytes32(salt);

        vm.broadcast();
        hook = new SkinHook{salt: salt}(poolManager, owner, treasury);
        require(address(hook) == expected, "mined address mismatch");
    }
}
