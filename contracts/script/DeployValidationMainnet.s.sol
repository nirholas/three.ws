// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ValidationRegistry} from "../src/ValidationRegistry.sol";

/// @notice Deploys ValidationRegistry to mainnet chains via CREATE2 (deterministic).
/// All 15 mainnet chains will share the same address via CREATE2.
///
/// Usage (dry-run):
///   forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
///     --rpc-url https://eth.merkle.io \
///     --sender 0x...
///
/// Usage (broadcast):
///   forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
///     --rpc-url https://eth.merkle.io \
///     --sender 0x... \
///     --private-key 0x... \
///     --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
contract DeployValidationMainnet is Script {
    // Canonical IdentityRegistry address (same on all mainnet chains)
    address constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    // CREATE2 salt for deterministic address across all chains
    bytes32 constant SALT = keccak256(abi.encodePacked("ValidationRegistry", uint256(1)));

    function run() external returns (ValidationRegistry validation) {
        address deployer = msg.sender;

        // Compute and log the expected address before broadcasting
        address predictedAddr = computeAddress(deployer);
        console.log("Expected ValidationRegistry:", predictedAddr);
        console.log("IdentityRegistry:          ", IDENTITY_REGISTRY);
        console.log("Deployer (owner):          ", deployer);
        console.log("---");

        vm.startBroadcast();

        // Deploy with CREATE2 for deterministic address
        validation = new ValidationRegistry{salt: SALT}(
            IDENTITY_REGISTRY,
            deployer
        );

        vm.stopBroadcast();

        require(address(validation) == predictedAddr, "Address mismatch!");
        console.log("✓ ValidationRegistry deployed at:", address(validation));
    }

    /// @notice Computes the CREATE2 address without deploying.
    /// @param owner The owner address that will be set in the constructor.
    function computeAddress(address owner) public pure returns (address) {
        bytes memory creationCode = type(ValidationRegistry).creationCode;
        bytes memory constructorArgs = abi.encode(IDENTITY_REGISTRY, owner);
        bytes32 codeHash = keccak256(abi.encodePacked(creationCode, constructorArgs));

        return address(uint160(uint256(
            keccak256(abi.encodePacked(
                bytes1(0xff),
                address(this),
                SALT,
                codeHash
            ))
        )));
    }
}
