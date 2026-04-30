// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ValidationRegistry} from "../src/ValidationRegistry.sol";

/// @notice Deploys ValidationRegistry to all 15 mainnet chains via CREATE2.
/// Because the salt and init-code (including constructor args) are constant,
/// the same address is produced on every chain.
///
/// IMPORTANT: use the SAME private key on every chain — the deployer address
/// is baked into the init-code as the constructor `owner_` arg.
///
/// Usage (dry-run — prints predicted address, no broadcast):
///   forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
///     --rpc-url $ETH_RPC_URL \
///     --sender $DEPLOYER_ADDRESS
///
/// Usage (broadcast + verify):
///   forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
///     --rpc-url $ETH_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
///
/// See deploy-validation-registry.sh for the full 15-chain command list.
contract DeployValidationMainnet is Script {
    // Canonical IdentityRegistry address (same on all 15 mainnet chains)
    address constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    // Nick's deterministic CREATE2 factory — present on every EVM chain
    address constant CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Salt chosen to produce the 0x8004... vanity prefix on mainnet
    bytes32 constant SALT = keccak256(abi.encodePacked("ValidationRegistry", uint256(1)));

    function run() external returns (ValidationRegistry validation) {
        address deployer = msg.sender;

        address predictedAddr = computeAddress(deployer);
        console.log("Predicted ValidationRegistry:", predictedAddr);
        console.log("IdentityRegistry:            ", IDENTITY_REGISTRY);
        console.log("Deployer / owner:            ", deployer);
        console.log("---");

        vm.startBroadcast();

        // Foundry routes new Contract{salt:}() through CREATE2_FACTORY in broadcast mode
        validation = new ValidationRegistry{salt: SALT}(
            IDENTITY_REGISTRY,
            deployer
        );

        vm.stopBroadcast();

        require(address(validation) == predictedAddr, "Address mismatch — wrong deployer or factory?");
        console.log("Deployed ValidationRegistry:", address(validation));
    }

    /// @notice Off-chain address prediction using Nick's factory.
    /// @dev Must match the address Foundry produces via new Contract{salt:}() in broadcast.
    /// @param owner The deployer address that will become the contract owner.
    function computeAddress(address owner) public pure returns (address) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(
            type(ValidationRegistry).creationCode,
            abi.encode(IDENTITY_REGISTRY, owner)
        ));
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            CREATE2_FACTORY,
            SALT,
            initCodeHash
        )))));
    }
}
