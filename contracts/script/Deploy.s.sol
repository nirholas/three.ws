// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/ValidationRegistry.sol";

/// @notice Deploys the three ERC-8004 registries. Run with:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $BASE_SEPOLIA_RPC_URL \
///     --private-key $DEPLOYER_PK \
///     --broadcast --verify
contract Deploy is Script {
    function run()
        external
        returns (IdentityRegistry identity, ReputationRegistry reputation, ValidationRegistry validation)
    {
        address deployer = msg.sender;

        vm.startBroadcast();

        identity = new IdentityRegistry();
        reputation = new ReputationRegistry(address(identity));
        validation = new ValidationRegistry(address(identity), deployer);

        vm.stopBroadcast();

        console.log("IdentityRegistry:  ", address(identity));
        console.log("ReputationRegistry:", address(reputation));
        console.log("ValidationRegistry:", address(validation));
        console.log("Owner (ValidationRegistry):", deployer);
    }
}
