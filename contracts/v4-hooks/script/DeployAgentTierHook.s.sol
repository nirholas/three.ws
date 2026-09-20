// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {AgentTierHook} from "../src/AgentTierHook.sol";
import {IERC8004Identity, IERC8004Reputation} from "../src/interfaces/IERC8004.sol";
import {HookMiner} from "./HookMiner.sol";

/// Deploys AgentTierHook at a mined, flag-matching address. The ERC-8004 registries sit at
/// the same address on every mainnet they are deployed to, so only POOL_MANAGER changes
/// from chain to chain.
///
///   POOL_MANAGER=0x498581ff718922c3f8e6a244956af099b2652b2b \
///   forge script script/DeployAgentTierHook.s.sol --rpc-url base --broadcast --verify
contract DeployAgentTierHook is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    IERC8004Identity constant IDENTITY = IERC8004Identity(0x8004A169FB4a3325136EB29fA0ceB6D2e539a432);
    IERC8004Reputation constant REPUTATION = IERC8004Reputation(0x8004BAa17C55a88189AE136b182e5fdA19dE9b63);
    // beforeInitialize | beforeSwap
    uint160 constant FLAGS = (1 << 13) | (1 << 7);

    function run() external returns (AgentTierHook hook) {
        IPoolManager poolManager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        require(address(IDENTITY).code.length != 0, "no ERC-8004 identity registry on this chain");
        require(address(REPUTATION).code.length != 0, "no ERC-8004 reputation registry on this chain");

        bytes memory initCode =
            abi.encodePacked(type(AgentTierHook).creationCode, abi.encode(poolManager, IDENTITY, REPUTATION));
        (address expected, bytes32 salt) = HookMiner.find(CREATE2_DEPLOYER, FLAGS, initCode);
        console2.log("AgentTierHook will deploy at", expected);
        console2.logBytes32(salt);

        vm.broadcast();
        hook = new AgentTierHook{salt: salt}(poolManager, IDENTITY, REPUTATION);
        require(address(hook) == expected, "mined address mismatch");
    }
}
