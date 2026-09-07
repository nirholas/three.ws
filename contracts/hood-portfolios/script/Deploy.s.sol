// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {PortfolioRegistry} from "../src/PortfolioRegistry.sol";
import {PortfolioFactory} from "../src/PortfolioFactory.sol";

/**
 * @title Deploy
 * @notice Deploys the registry and factory, and wires the factory as an approved linker.
 *
 * @dev Usage (Robinhood Chain, chain id 4663):
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url https://rpc.mainnet.chain.robinhood.com \
 *     --private-key $DEPLOYER_KEY \
 *     --broadcast
 *
 * Set `ATTESTER` to the address whose EIP-712 signature `publish` will accept; it
 * defaults to the deployer, which is right for a first bring-up and wrong for
 * anything else. Set `OWNER` to the address that will govern the attester set,
 * which should be a multisig on any real deployment.
 *
 * Run without `--broadcast` first: that simulates the whole thing against live
 * state and prints the addresses without spending anything.
 */
contract Deploy is Script {
    function run() external returns (PortfolioRegistry registry, PortfolioFactory factory) {
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);
        address attester = vm.envOr("ATTESTER", deployer);

        vm.startBroadcast();

        // The registry is deployed owned by the deployer so the factory can be
        // approved in the same broadcast, then handed to `owner` at the end.
        // Transferring first would make the approval below revert.
        registry = new PortfolioRegistry(deployer, attester);
        factory = new PortfolioFactory(address(registry));
        registry.setFactory(address(factory), true);
        if (owner != deployer) registry.transferOwnership(owner);

        vm.stopBroadcast();

        console2.log("chain id          ", block.chainid);
        console2.log("PortfolioRegistry ", address(registry));
        console2.log("PortfolioFactory  ", address(factory));
        console2.log("owner             ", owner);
        console2.log("attester          ", attester);
    }
}
